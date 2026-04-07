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

    // Render loop
    const aspect = carpetSize.width / carpetSize.height
    const render = () => {
      ctx.clearRect(0, 0, W, H)

      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(rotation)

      // Apply perspective skew for floor effect
      const perspectiveScale = 0.7 + (cy / H) * 0.6
      ctx.scale(scale * perspectiveScale, scale)

      const drawH = H * 0.5
      const drawW = drawH * aspect
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH)

      // Subtle shadow
      ctx.shadowColor = 'rgba(0,0,0,0.3)'
      ctx.shadowBlur = 20
      ctx.shadowOffsetY = 10

      ctx.restore()

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
