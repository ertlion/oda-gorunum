import * as THREE from 'three'

/**
 * AR Mode — WebXR ile telefonun kamerasını açıp halıyı gerçek zemine yerleştirir
 *
 * Desteklenen: Android Chrome (ARCore gerekli)
 * iOS: Kamera görüntüsü + overlay fallback
 */
export class ARMode {
  constructor() {
    this.renderer = null
    this.scene = null
    this.camera = null
    this.session = null
    this.hitTestSource = null
    this.referenceSpace = null
    this.reticle = null
    this.carpet = null
    this.isPlaced = false
    this.container = null
    this.onEnd = null

    this._frameCallback = this._onFrame.bind(this)
  }

  async checkSupport() {
    if (!navigator.xr) return { webxr: false, camera: !!navigator.mediaDevices }
    try {
      const webxr = await navigator.xr.isSessionSupported('immersive-ar')
      return { webxr, camera: !!navigator.mediaDevices }
    } catch {
      return { webxr: false, camera: !!navigator.mediaDevices }
    }
  }

  /**
   * WebXR AR Mode — gerçek zemin algılama
   */
  async startWebXR(container, carpetTexture, carpetSize, onEnd) {
    this.container = container
    this.onEnd = onEnd
    this.isPlaced = false

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.xr.enabled = true
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(this.renderer.domElement)

    // Scene
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20)

    // Lights
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.6))
    const sun = new THREE.DirectionalLight('#ffffff', 1.0)
    sun.position.set(1, 3, 2)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    this.scene.add(sun)

    // Reticle (floor targeting indicator)
    this.reticle = this._createReticle()
    this.reticle.visible = false
    this.scene.add(this.reticle)

    // Create carpet mesh (hidden until placement)
    this._buildCarpetMesh(carpetTexture, carpetSize)
    this.carpet.visible = false

    // Start AR session
    try {
      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'light-estimation'],
        domOverlay: { root: document.getElementById('ar-overlay') }
      })

      this.session = session
      this.renderer.xr.setReferenceSpaceType('local')
      await this.renderer.xr.setSession(session)

      // Hit test source
      const viewerSpace = await session.requestReferenceSpace('viewer')
      this.referenceSpace = await session.requestReferenceSpace('local')
      this.hitTestSource = await session.requestHitTestSource({ space: viewerSpace })

      // Tap to place
      session.addEventListener('select', () => this._onTap())
      session.addEventListener('end', () => this._cleanup())

      // Render loop
      this.renderer.setAnimationLoop(this._frameCallback)

      return true
    } catch (err) {
      console.error('WebXR AR failed:', err)
      this._cleanup()
      return false
    }
  }

  /**
   * Camera Overlay Mode (iOS fallback)
   * Kamerayı açar, halı görselini üstüne yerleştirir
   */
  async startCameraOverlay(container, carpetTexture, carpetSize, onEnd) {
    this.container = container
    this.onEnd = onEnd

    const wrapper = document.createElement('div')
    wrapper.id = 'camera-ar-wrapper'
    wrapper.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#000;'

    // Camera video
    const video = document.createElement('video')
    video.style.cssText = 'width:100%;height:100%;object-fit:cover;'
    video.setAttribute('playsinline', '')
    video.setAttribute('autoplay', '')
    wrapper.appendChild(video)

    // Carpet overlay canvas
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;'
    wrapper.appendChild(canvas)

    // Controls overlay
    const controls = document.createElement('div')
    controls.innerHTML = `
      <div style="position:absolute;bottom:20px;left:50%;transform:translateX(-50%);display:flex;gap:12px;z-index:10001;">
        <button id="ar-cam-close" style="background:#e94560;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:16px;font-weight:600;">Kapat</button>
      </div>
      <div style="position:absolute;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.6);color:#fff;padding:8px 16px;border-radius:8px;font-size:14px;">
        Halıyı parmağınla sürükle · İki parmakla döndür/boyutlandır
      </div>
    `
    wrapper.appendChild(controls)

    container.appendChild(wrapper)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      })
      video.srcObject = stream
      await video.play()

      // Setup canvas carpet rendering
      this._setupCameraOverlayCanvas(canvas, carpetTexture, carpetSize)

      // Close button
      wrapper.querySelector('#ar-cam-close').addEventListener('click', () => {
        stream.getTracks().forEach(t => t.stop())
        wrapper.remove()
        if (this.onEnd) this.onEnd()
      })

    } catch (err) {
      console.error('Camera access failed:', err)
      wrapper.remove()
      alert('Kamera erişimi reddedildi. Tarayıcı ayarlarından kamera iznini verin.')
      if (onEnd) onEnd()
    }
  }

  _setupCameraOverlayCanvas(canvas, carpetTexture, carpetSize) {
    const ctx = canvas.getContext('2d')
    canvas.width = window.innerWidth * window.devicePixelRatio
    canvas.height = window.innerHeight * window.devicePixelRatio
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

    const W = window.innerWidth
    const H = window.innerHeight

    // Carpet state
    let cx = W / 2
    let cy = H * 0.6
    let scale = 0.4
    let rotation = 0

    // Extract image from texture
    const img = carpetTexture.image || carpetTexture.source?.data
    if (!img) return

    // Touch handling
    let activeTouches = []
    let lastDist = 0
    let lastAngle = 0
    let isDragging = false
    let dragStart = { x: 0, y: 0 }

    const getTouch = (e) => Array.from(e.touches)

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault()
      activeTouches = getTouch(e)
      if (activeTouches.length === 1) {
        isDragging = true
        dragStart = { x: activeTouches[0].clientX - cx, y: activeTouches[0].clientY - cy }
      } else if (activeTouches.length === 2) {
        isDragging = false
        const dx = activeTouches[1].clientX - activeTouches[0].clientX
        const dy = activeTouches[1].clientY - activeTouches[0].clientY
        lastDist = Math.sqrt(dx * dx + dy * dy)
        lastAngle = Math.atan2(dy, dx)
      }
    }, { passive: false })

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault()
      activeTouches = getTouch(e)
      if (activeTouches.length === 1 && isDragging) {
        cx = activeTouches[0].clientX - dragStart.x
        cy = activeTouches[0].clientY - dragStart.y
      } else if (activeTouches.length === 2) {
        const dx = activeTouches[1].clientX - activeTouches[0].clientX
        const dy = activeTouches[1].clientY - activeTouches[0].clientY
        const dist = Math.sqrt(dx * dx + dy * dy)
        const angle = Math.atan2(dy, dx)

        scale *= dist / lastDist
        scale = Math.max(0.1, Math.min(2, scale))
        rotation += angle - lastAngle

        lastDist = dist
        lastAngle = angle
      }
    }, { passive: false })

    canvas.addEventListener('touchend', (e) => {
      activeTouches = getTouch(e)
      if (activeTouches.length === 0) isDragging = false
    })

    // Mouse fallback (desktop testing)
    let mouseDown = false
    canvas.addEventListener('mousedown', (e) => {
      mouseDown = true
      dragStart = { x: e.clientX - cx, y: e.clientY - cy }
    })
    canvas.addEventListener('mousemove', (e) => {
      if (!mouseDown) return
      cx = e.clientX - dragStart.x
      cy = e.clientY - dragStart.y
    })
    canvas.addEventListener('mouseup', () => { mouseDown = false })
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      scale *= e.deltaY > 0 ? 0.95 : 1.05
      scale = Math.max(0.1, Math.min(2, scale))
    }, { passive: false })

    // Perspective floor rendering
    // Halıyı 4 köşe ile zemine yatırıyoruz (trapez perspektif)
    const aspect = carpetSize.width / carpetSize.height

    // Offscreen canvas for carpet source
    const offCanvas = document.createElement('canvas')
    offCanvas.width = img.width || 512
    offCanvas.height = img.height || 512
    const offCtx = offCanvas.getContext('2d')
    offCtx.drawImage(img, 0, 0, offCanvas.width, offCanvas.height)

    /**
     * Perspektif warp: Kaynak dikdörtgeni hedef dörtgene (trapez) çizer
     * Üçgen subdivision ile yapılır — daha fazla subdivision = daha düzgün warp
     */
    const drawPerspective = (srcImg, srcW, srcH, dstCorners) => {
      // dstCorners: [topLeft, topRight, bottomRight, bottomLeft] her biri {x, y}
      const subdivisions = 12

      for (let row = 0; row < subdivisions; row++) {
        for (let col = 0; col < subdivisions; col++) {
          const u0 = col / subdivisions
          const v0 = row / subdivisions
          const u1 = (col + 1) / subdivisions
          const v1 = (row + 1) / subdivisions

          // Bilinear interpolation for destination quad
          const lerp = (a, b, t) => a + (b - a) * t
          const bilerp = (tl, tr, br, bl, u, v) => ({
            x: lerp(lerp(tl.x, tr.x, u), lerp(bl.x, br.x, u), v),
            y: lerp(lerp(tl.y, tr.y, u), lerp(bl.y, br.y, u), v)
          })

          const [tl, tr, br, bl] = dstCorners
          const p00 = bilerp(tl, tr, br, bl, u0, v0)
          const p10 = bilerp(tl, tr, br, bl, u1, v0)
          const p01 = bilerp(tl, tr, br, bl, u0, v1)
          const p11 = bilerp(tl, tr, br, bl, u1, v1)

          // Source coordinates
          const sx0 = u0 * srcW
          const sy0 = v0 * srcH
          const sx1 = u1 * srcW
          const sy1 = v1 * srcH
          const sw = sx1 - sx0
          const sh = sy1 - sy0

          // Draw two triangles per cell using affine transform
          // Triangle 1: p00, p10, p01
          drawTriangle(srcImg, sx0, sy0, sw, sh, p00, p10, p01, false)
          // Triangle 2: p10, p11, p01
          drawTriangle(srcImg, sx0, sy0, sw, sh, p10, p11, p01, true)
        }
      }
    }

    const drawTriangle = (srcImg, sx, sy, sw, sh, p0, p1, p2, isSecond) => {
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.lineTo(p2.x, p2.y)
      ctx.closePath()
      ctx.clip()

      // Affine transform: map source triangle to destination triangle
      // For first triangle: (0,0), (1,0), (0,1)
      // For second triangle: (1,0), (1,1), (0,1)
      let dx0, dy0, dx1, dy1, dx2, dy2

      if (!isSecond) {
        // Source: topLeft(0,0), topRight(1,0), bottomLeft(0,1)
        dx0 = p0.x; dy0 = p0.y  // maps to (sx, sy)
        dx1 = p1.x; dy1 = p1.y  // maps to (sx+sw, sy)
        dx2 = p2.x; dy2 = p2.y  // maps to (sx, sy+sh)
      } else {
        // Source: topRight(1,0), bottomRight(1,1), bottomLeft(0,1)
        dx0 = p2.x; dy0 = p2.y  // bottomLeft maps to (sx, sy+sh)
        dx1 = p0.x; dy1 = p0.y  // topRight maps to (sx+sw, sy)
        dx2 = p1.x; dy2 = p1.y  // bottomRight maps to (sx+sw, sy+sh)
        // Remap: want (sx, sy) → bottomLeft, (sx+sw, sy) → topRight, (sx, sy+sh) → bottomRight
        // Actually simpler approach: use the affine from unit square
      }

      // Compute affine: maps (sx,sy)→p_tl, (sx+sw,sy)→p_tr, (sx,sy+sh)→p_bl of this sub-cell
      // setTransform(a, b, c, d, e, f) where:
      //   destX = a*srcX + c*srcY + e
      //   destY = b*srcX + d*srcY + f

      let stl, str, sbl
      if (!isSecond) {
        stl = p0; str = p1; sbl = p2
      } else {
        // For second triangle, we map differently
        // (sx, sy) → p0-offset, but easier: just use direct mapping
        stl = { x: p2.x + p0.x - p1.x, y: p2.y + p0.y - p1.y } // virtual top-left
        str = p0
        sbl = p2
      }

      const a = (str.x - stl.x) / sw
      const b = (str.y - stl.y) / sw
      const c = (sbl.x - stl.x) / sh
      const d = (sbl.y - stl.y) / sh
      const e = stl.x - a * sx - c * sy
      const f = stl.y - b * sx - d * sy

      ctx.setTransform(a, b, c, d, e, f)
      ctx.drawImage(srcImg, sx, sy, sw, sh, sx, sy, sw, sh)

      ctx.restore()
    }

    const render = () => {
      ctx.clearRect(0, 0, W, H)

      // Calculate perspective trapezoid corners
      // Halı zemine yatmış gibi: üst kenar dar, alt kenar geniş
      const baseW = W * 0.55 * scale
      const baseH = baseW / aspect

      // Perspektif oranı: y pozisyonuna göre
      // Üst kenar daraltma oranı (vanishing point efekti)
      const perspAmount = 0.45  // ne kadar perspektif (0=yok, 1=çok)
      const topNarrow = 1 - perspAmount  // üst kenar genişlik çarpanı

      // Döndürme ile birlikte köşeleri hesapla
      const cos = Math.cos(rotation)
      const sin = Math.sin(rotation)

      // Perspektif köşeleri (döndürmeden önce, merkez 0,0)
      const hw = baseW / 2
      const hh = baseH / 2
      const topW = hw * topNarrow

      const corners = [
        { x: -topW, y: -hh },       // top-left (dar)
        { x: topW, y: -hh },        // top-right (dar)
        { x: hw, y: hh },           // bottom-right (geniş)
        { x: -hw, y: hh }           // bottom-left (geniş)
      ]

      // Döndür ve pozisyona taşı
      const transformed = corners.map(p => ({
        x: cx + p.x * cos - p.y * sin,
        y: cy + p.x * sin + p.y * cos
      }))

      // Gölge çiz
      ctx.save()
      ctx.globalAlpha = 0.15
      ctx.fillStyle = '#000'
      ctx.beginPath()
      ctx.moveTo(transformed[0].x + 3, transformed[0].y + 5)
      ctx.lineTo(transformed[1].x + 3, transformed[1].y + 5)
      ctx.lineTo(transformed[2].x + 3, transformed[2].y + 5)
      ctx.lineTo(transformed[3].x + 3, transformed[3].y + 5)
      ctx.closePath()
      ctx.fill()
      ctx.restore()

      // Halıyı perspektif warp ile çiz
      drawPerspective(offCanvas, offCanvas.width, offCanvas.height, transformed)

      this._cameraRafId = requestAnimationFrame(render)
    }
    render()
  }

  // ─── WebXR Helpers ───

  _createReticle() {
    const group = new THREE.Group()

    // Outer ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.15, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#e94560', transparent: true, opacity: 0.8 })
    )
    group.add(ring)

    // Inner dot
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.02, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#e94560' })
    )
    group.add(dot)

    // Size guide (dashed rectangle)
    const edges = new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.5, 0.5))
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineDashedMaterial({ color: '#e94560', dashSize: 0.05, gapSize: 0.03, transparent: true, opacity: 0.5 })
    )
    line.rotation.x = -Math.PI / 2
    line.computeLineDistances()
    group.add(line)

    return group
  }

  _buildCarpetMesh(texture, size) {
    const geo = new THREE.PlaneGeometry(size.width, size.height)
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide
    })
    this.carpet = new THREE.Mesh(geo, mat)
    this.carpet.rotation.x = -Math.PI / 2
    this.carpet.receiveShadow = true
    this.scene.add(this.carpet)
  }

  _onFrame(timestamp, frame) {
    if (!frame || !this.hitTestSource || !this.referenceSpace) return

    const hitTestResults = frame.getHitTestResults(this.hitTestSource)

    if (hitTestResults.length > 0 && !this.isPlaced) {
      const hit = hitTestResults[0]
      const pose = hit.getPose(this.referenceSpace)

      if (pose) {
        this.reticle.visible = true
        this.reticle.matrix.fromArray(pose.transform.matrix)
        this.reticle.matrixAutoUpdate = false
      }
    }

    this.renderer.render(this.scene, this.camera)
  }

  _onTap() {
    if (!this.reticle.visible) return

    if (!this.isPlaced) {
      // Place carpet at reticle position
      this.carpet.position.setFromMatrixPosition(this.reticle.matrix)
      this.carpet.visible = true
      this.isPlaced = true
      this.reticle.visible = false
    } else {
      // Move carpet to new position
      const hitTestResults = this.renderer.xr.getFrame()?.getHitTestResults(this.hitTestSource)
      if (hitTestResults?.length > 0) {
        const pose = hitTestResults[0].getPose(this.referenceSpace)
        if (pose) {
          this.carpet.position.set(
            pose.transform.position.x,
            pose.transform.position.y,
            pose.transform.position.z
          )
        }
      }
    }
  }

  _cleanup() {
    if (this.renderer) {
      this.renderer.setAnimationLoop(null)
      if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement)
      }
      this.renderer.dispose()
    }

    if (this._cameraRafId) {
      cancelAnimationFrame(this._cameraRafId)
    }

    this.session = null
    this.hitTestSource = null
    this.renderer = null
    this.scene = null
    this.carpet = null
    this.reticle = null

    if (this.onEnd) this.onEnd()
  }

  stop() {
    if (this.session) {
      this.session.end()
    } else {
      this._cleanup()
    }

    // Clean up camera overlay if exists
    const wrapper = document.getElementById('camera-ar-wrapper')
    if (wrapper) {
      const video = wrapper.querySelector('video')
      if (video?.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop())
      }
      wrapper.remove()
    }
  }
}
