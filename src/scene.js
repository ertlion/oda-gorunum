import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { ROOMS, CARPET_DEFAULTS } from './rooms.js'

export class RoomScene {
  constructor(container) {
    this.container = container
    this.currentRoom = null
    this.carpet = null
    this.carpetSize = { width: CARPET_DEFAULTS.width, height: CARPET_DEFAULTS.height }
    this.carpetRotation = 0
    this.isDraggingCarpet = false
    this.raycaster = new THREE.Raycaster()
    this.mouse = new THREE.Vector2()
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    this.dragOffset = new THREE.Vector3()
    this.floorMesh = null
    this._lastCarpetTexture = null

    this._init()
    this._setupDrag()
  }

  _init() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setSize(w, h)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog('#e8e4df', 8, 18)

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02
    this.controls.minDistance = 1.5
    this.controls.maxDistance = 10
    this.controls.target.set(0, 0, 0)

    // Generate env map for reflections
    this._generateEnvMap()

    this._onResize = () => {
      const w = this.container.clientWidth
      const h = this.container.clientHeight
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(w, h)
    }
    window.addEventListener('resize', this._onResize)

    this._animate()
  }

  _generateEnvMap() {
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const envScene = new THREE.Scene()

    // Gradient sky dome
    const skyGeo = new THREE.SphereGeometry(10, 32, 32)
    const skyCanvas = document.createElement('canvas')
    skyCanvas.width = 256
    skyCanvas.height = 256
    const sCtx = skyCanvas.getContext('2d')
    const grad = sCtx.createLinearGradient(0, 0, 0, 256)
    grad.addColorStop(0, '#87CEEB')
    grad.addColorStop(0.4, '#E0E8F0')
    grad.addColorStop(0.6, '#F5F0E8')
    grad.addColorStop(1, '#DDD5C5')
    sCtx.fillStyle = grad
    sCtx.fillRect(0, 0, 256, 256)
    const skyTex = new THREE.CanvasTexture(skyCanvas)
    const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide })
    envScene.add(new THREE.Mesh(skyGeo, skyMat))

    this.envMap = pmrem.fromScene(envScene, 0.04).texture
    pmrem.dispose()
    skyTex.dispose()
    skyMat.dispose()
    skyGeo.dispose()
  }

  _animate() {
    requestAnimationFrame(() => this._animate())
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  // ─── Room Building ───

  loadRoom(roomKey) {
    const room = ROOMS[roomKey]
    if (!room) return
    this.currentRoom = room

    // Clear scene
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => { if (m.map) m.map.dispose(); m.dispose() })
        } else {
          if (obj.material.map) obj.material.map.dispose()
          obj.material.dispose()
        }
      }
    })
    this.scene.clear()
    this.carpet = null

    const { width, depth, height } = room.dimensions
    const hw = width / 2
    const hd = depth / 2

    this._addLights(room, hw, hd, height)
    this._buildFloor(room, hw, hd)
    this._buildWalls(room, hw, hd, height)
    this._buildCeiling(room, hw, hd, height)
    this._buildBaseboards(room, hw, hd)
    this._buildWindows(room)
    this._buildFurniture(room)

    // Camera
    const [cx, cy, cz] = room.camera.position
    const [tx, ty, tz] = room.camera.target
    this.camera.position.set(cx, cy, cz)
    this.controls.target.set(tx, ty, tz)
    this.controls.update()

    this.scene.fog.color.set(room.colors.walls)

    if (this._lastCarpetTexture) {
      this._createCarpetMesh(this._lastCarpetTexture)
    }
  }

  _addLights(room, hw, hd, height) {
    // Soft ambient
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.35))

    // Hemisphere: warm ground, cool sky
    const hemi = new THREE.HemisphereLight('#b4d4e8', '#c4a872', 0.4)
    this.scene.add(hemi)

    // Main sunlight
    const sun = new THREE.DirectionalLight('#fff5e0', 1.4)
    sun.position.set(hw * 0.8, height + 2, hd * 0.5)
    sun.castShadow = true
    sun.shadow.mapSize.width = 2048
    sun.shadow.mapSize.height = 2048
    sun.shadow.camera.left = -hw * 2
    sun.shadow.camera.right = hw * 2
    sun.shadow.camera.top = hd * 2
    sun.shadow.camera.bottom = -hd * 2
    sun.shadow.camera.near = 0.1
    sun.shadow.camera.far = 30
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.02
    this.scene.add(sun)

    // Fill from opposite side
    const fill = new THREE.DirectionalLight('#c8d8f0', 0.5)
    fill.position.set(-hw, height, -hd)
    this.scene.add(fill)

    // Warm bounce from floor
    const bounce = new THREE.PointLight('#e8d0b0', 0.3, hw * 3)
    bounce.position.set(0, 0.1, 0)
    this.scene.add(bounce)
  }

  // ─── Textures ───

  _createParquetTexture(baseColor, scale = 4) {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 1024
    const ctx = canvas.getContext('2d')
    const base = new THREE.Color(baseColor)

    const plankW = 128
    const plankH = 512

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const offset = (row % 2) * (plankW / 2)
        const x = col * plankW + offset
        const y = row * (plankH / 4)

        // Variation per plank
        const v = (Math.random() - 0.5) * 0.06
        const r = Math.min(255, Math.max(0, Math.round((base.r + v) * 255)))
        const g = Math.min(255, Math.max(0, Math.round((base.g + v) * 255)))
        const b = Math.min(255, Math.max(0, Math.round((base.b + v) * 255)))

        ctx.fillStyle = `rgb(${r},${g},${b})`
        ctx.fillRect(x, y, plankW - 1, plankH / 4 - 1)

        // Wood grain lines
        ctx.save()
        ctx.globalAlpha = 0.06
        ctx.strokeStyle = '#000'
        ctx.lineWidth = 0.5
        for (let i = 0; i < 12; i++) {
          const gy = y + Math.random() * (plankH / 4)
          ctx.beginPath()
          ctx.moveTo(x + 2, gy)
          ctx.bezierCurveTo(
            x + plankW * 0.3, gy + (Math.random() - 0.5) * 6,
            x + plankW * 0.7, gy + (Math.random() - 0.5) * 6,
            x + plankW - 2, gy + (Math.random() - 0.5) * 3
          )
          ctx.stroke()
        }
        ctx.restore()

        // Knot (rare)
        if (Math.random() < 0.08) {
          ctx.save()
          ctx.globalAlpha = 0.1
          ctx.fillStyle = '#3a2a1a'
          ctx.beginPath()
          ctx.ellipse(
            x + Math.random() * plankW,
            y + Math.random() * (plankH / 4),
            4 + Math.random() * 6,
            3 + Math.random() * 4,
            Math.random() * Math.PI, 0, Math.PI * 2
          )
          ctx.fill()
          ctx.restore()
        }

        // Gap between planks
        ctx.fillStyle = 'rgba(0,0,0,0.15)'
        ctx.fillRect(x + plankW - 1, y, 1, plankH / 4)
        ctx.fillRect(x, y + plankH / 4 - 1, plankW, 1)
      }
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(scale, scale)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  _createWallTexture(baseColor) {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = baseColor
    ctx.fillRect(0, 0, 512, 512)

    // Subtle plaster texture
    ctx.globalAlpha = 0.015
    for (let i = 0; i < 3000; i++) {
      const x = Math.random() * 512
      const y = Math.random() * 512
      const s = Math.random() * 3 + 1
      ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff'
      ctx.fillRect(x, y, s, s)
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(2, 2)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  _createNormalMap(type = 'floor') {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')

    // Flat normal base (128,128,255 = pointing up)
    ctx.fillStyle = 'rgb(128,128,255)'
    ctx.fillRect(0, 0, 512, 512)

    if (type === 'floor') {
      // Plank edge normals
      ctx.globalAlpha = 0.3
      for (let y = 0; y < 512; y += 64) {
        ctx.fillStyle = 'rgb(128,100,255)'
        ctx.fillRect(0, y, 512, 2)
        ctx.fillStyle = 'rgb(128,155,255)'
        ctx.fillRect(0, y + 2, 512, 1)
      }
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(4, 4)
    return texture
  }

  // ─── Room Parts ───

  _buildFloor(room, hw, hd) {
    const geo = new THREE.PlaneGeometry(hw * 2, hd * 2)
    const map = this._createParquetTexture(room.colors.floor)
    const normalMap = this._createNormalMap('floor')
    const mat = new THREE.MeshPhysicalMaterial({
      map,
      normalMap,
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughness: 0.65,
      metalness: 0,
      clearcoat: 0.1,
      clearcoatRoughness: 0.8,
      envMap: this.envMap,
      envMapIntensity: 0.2
    })
    const floor = new THREE.Mesh(geo, mat)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    floor.name = 'floor'
    this.scene.add(floor)
    this.floorMesh = floor
  }

  _buildWalls(room, hw, hd, height) {
    const wallTex = this._createWallTexture(room.colors.walls)
    const makeMat = () => new THREE.MeshStandardMaterial({
      map: wallTex.clone(),
      roughness: 0.92,
      metalness: 0,
      envMap: this.envMap,
      envMapIntensity: 0.05
    })

    // Back wall
    const back = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, height), makeMat())
    back.position.set(0, height / 2, -hd)
    back.receiveShadow = true
    this.scene.add(back)

    // Left wall
    const left = new THREE.Mesh(new THREE.PlaneGeometry(hd * 2, height), makeMat())
    left.position.set(-hw, height / 2, 0)
    left.rotation.y = Math.PI / 2
    left.receiveShadow = true
    this.scene.add(left)

    // Right wall
    const right = new THREE.Mesh(new THREE.PlaneGeometry(hd * 2, height), makeMat())
    right.position.set(hw, height / 2, 0)
    right.rotation.y = -Math.PI / 2
    right.receiveShadow = true
    this.scene.add(right)
  }

  _buildCeiling(room, hw, hd, height) {
    const mat = new THREE.MeshStandardMaterial({
      color: room.colors.ceiling,
      roughness: 0.95,
      metalness: 0
    })
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, hd * 2), mat)
    ceiling.rotation.x = Math.PI / 2
    ceiling.position.y = height
    this.scene.add(ceiling)
  }

  _buildBaseboards(room, hw, hd) {
    const h = 0.1
    const d = 0.025
    const mat = new THREE.MeshStandardMaterial({ color: room.colors.baseboard, roughness: 0.5 })

    // Profile shape for baseboard (simple extrusion effect with 2 boxes)
    const addBaseboard = (pos, rot, len) => {
      const base = new THREE.Mesh(new THREE.BoxGeometry(len, h, d), mat)
      base.position.copy(pos)
      base.rotation.y = rot
      base.castShadow = true
      this.scene.add(base)

      // Top lip
      const lip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.015, d + 0.005), mat.clone())
      lip.position.copy(pos)
      lip.position.y += h / 2 + 0.007
      lip.rotation.y = rot
      this.scene.add(lip)
    }

    addBaseboard(new THREE.Vector3(0, h / 2, -hd + d / 2), 0, hw * 2)
    addBaseboard(new THREE.Vector3(-hw + d / 2, h / 2, 0), Math.PI / 2, hd * 2)
    addBaseboard(new THREE.Vector3(hw - d / 2, h / 2, 0), Math.PI / 2, hd * 2)
  }

  _buildWindows(room) {
    if (!room.windows) return

    for (const win of room.windows) {
      const [wx, wy, wz] = win.position
      const [ww, wh] = win.size

      // Window recess
      const recessDepth = 0.15
      const frameMat = new THREE.MeshStandardMaterial({
        color: '#f5f5f5',
        roughness: 0.3,
        metalness: 0.05
      })

      // Frame (4 pieces)
      const frameW = 0.04
      const pieces = [
        { s: [ww + frameW * 2, frameW, recessDepth], p: [0, wh / 2 + frameW / 2, 0] },
        { s: [ww + frameW * 2, frameW, recessDepth], p: [0, -wh / 2 - frameW / 2, 0] },
        { s: [frameW, wh, recessDepth], p: [-ww / 2 - frameW / 2, 0, 0] },
        { s: [frameW, wh, recessDepth], p: [ww / 2 + frameW / 2, 0, 0] },
        // Cross divider
        { s: [ww, frameW * 0.7, recessDepth * 0.5], p: [0, 0, 0] },
        { s: [frameW * 0.7, wh, recessDepth * 0.5], p: [0, 0, 0] }
      ]

      const group = new THREE.Group()
      group.position.set(wx, wy, wz)

      if (win.wall === 'left') group.rotation.y = Math.PI / 2
      else if (win.wall === 'right') group.rotation.y = -Math.PI / 2

      for (const p of pieces) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...p.s), frameMat)
        mesh.position.set(...p.p)
        mesh.castShadow = true
        group.add(mesh)
      }

      // Glass
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: '#d4e8ff',
        transparent: true,
        opacity: 0.15,
        roughness: 0.05,
        metalness: 0,
        transmission: 0.9,
        thickness: 0.01
      })
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), glassMat)
      glass.position.z = recessDepth * 0.3
      group.add(glass)

      this.scene.add(group)

      // Warm window light
      const wLight = new THREE.RectAreaLight('#fff8e0', 3, ww, wh)
      wLight.position.set(wx, wy, wz)
      if (win.wall === 'left') wLight.rotation.y = Math.PI / 2
      else if (win.wall === 'right') wLight.rotation.y = -Math.PI / 2
      this.scene.add(wLight)

      // Light shaft
      const shaft = new THREE.SpotLight('#fff5e0', 0.6, 8, Math.PI / 4, 0.8, 1)
      shaft.position.set(
        wx + (win.wall === 'left' ? 0.5 : win.wall === 'right' ? -0.5 : 0),
        wy + 0.5,
        wz + (win.wall === 'back' ? 1 : 0)
      )
      shaft.target.position.set(0, 0, 0)
      this.scene.add(shaft)
      this.scene.add(shaft.target)
    }
  }

  // ─── Furniture Builders ───

  _buildFurniture(room) {
    for (const item of room.furniture) {
      switch (item.type) {
        case 'sofa': this._buildSofa(item); break
        case 'armchair': this._buildArmchair(item); break
        case 'coffeeTable':
        case 'table': this._buildTable(item); break
        case 'bed': this._buildBed(item); break
        case 'headboard': this._buildBox(item, { roughness: 0.5, clearcoat: 0.3 }); break
        case 'shelf':
        case 'wardrobe':
        case 'cabinet':
        case 'sideboard': this._buildCabinet(item); break
        case 'plant': this._buildPlant(item); break
        case 'lamp': this._buildLamp(item); break
        case 'tv': this._buildTV(item); break
        case 'nightstand': this._buildTable(item); break
        case 'chair': this._buildChair(item); break
        default: this._buildBox(item); break
      }
    }
  }

  _mat(color, opts = {}) {
    return new THREE.MeshPhysicalMaterial({
      color,
      roughness: opts.roughness ?? 0.8,
      metalness: opts.metalness ?? 0,
      clearcoat: opts.clearcoat ?? 0,
      clearcoatRoughness: opts.clearcoatRoughness ?? 0.6,
      envMap: this.envMap,
      envMapIntensity: opts.envIntensity ?? 0.15,
      ...opts
    })
  }

  _addMesh(geo, mat, pos, opts = {}) {
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(...pos)
    if (opts.rotation) mesh.rotation.set(...opts.rotation)
    mesh.castShadow = opts.castShadow !== false
    mesh.receiveShadow = opts.receiveShadow !== false
    this.scene.add(mesh)
    return mesh
  }

  _buildSofa(item) {
    const [sx, sy, sz] = item.size
    const [px, py, pz] = item.position
    const col = new THREE.Color(item.color)
    const fabric = this._mat(col, { roughness: 0.92 })
    const darkFabric = this._mat(col.clone().offsetHSL(0, 0, -0.06), { roughness: 0.9 })

    // Base/frame
    this._addMesh(
      new THREE.BoxGeometry(sx, sy * 0.45, sz),
      fabric, [px, py * 0.5, pz]
    )

    // Seat cushions (2-3)
    const cushionCount = Math.max(2, Math.round(sx / 0.7))
    const cw = (sx - 0.06) / cushionCount
    for (let i = 0; i < cushionCount; i++) {
      const cx = px - sx / 2 + cw / 2 + 0.03 + i * cw
      // Slightly rounded cushion top
      this._addMesh(
        new THREE.BoxGeometry(cw - 0.03, sy * 0.2, sz * 0.65),
        fabric, [cx, py + sy * 0.1, pz + sz * 0.08]
      )
    }

    // Backrest
    this._addMesh(
      new THREE.BoxGeometry(sx, sy * 0.7, sz * 0.18),
      darkFabric, [px, py + sy * 0.35, pz - sz * 0.4]
    )

    // Arms (rounded)
    for (const side of [-1, 1]) {
      const armX = px + side * (sx / 2 + 0.02)
      // Arm body
      this._addMesh(
        new THREE.BoxGeometry(0.12, sy * 0.55, sz),
        darkFabric, [armX, py + sy * 0.05, pz]
      )
      // Arm top (rounded)
      this._addMesh(
        new THREE.CylinderGeometry(0.06, 0.06, sz, 12),
        darkFabric, [armX, py + sy * 0.33, pz],
        { rotation: [Math.PI / 2, 0, 0] }
      )
    }

    // Legs
    const legMat = this._mat('#2a2a2a', { metalness: 0.4, roughness: 0.3 })
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        this._addMesh(
          new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8),
          legMat,
          [px + dx * (sx / 2 - 0.08), 0.06, pz + dz * (sz / 2 - 0.08)]
        )
      }
    }

    // Throw pillows
    const pillowColors = ['#c1a87c', '#8b6f5c', '#a0a0a0']
    for (let i = 0; i < 2; i++) {
      const pillowMat = this._mat(pillowColors[i % pillowColors.length], { roughness: 0.95 })
      this._addMesh(
        new THREE.BoxGeometry(0.35, 0.35, 0.08),
        pillowMat,
        [px + (i === 0 ? -sx * 0.3 : sx * 0.3), py + sy * 0.35, pz - sz * 0.15],
        { rotation: [0.1, (i - 0.5) * 0.3, (i - 0.5) * 0.15] }
      )
    }
  }

  _buildArmchair(item) {
    const [sx, sy, sz] = item.size
    const [px, py, pz] = item.position
    const fabric = this._mat(item.color, { roughness: 0.9 })
    const dark = this._mat(new THREE.Color(item.color).offsetHSL(0, 0, -0.05), { roughness: 0.88 })

    // Seat
    this._addMesh(new THREE.BoxGeometry(sx, sy * 0.4, sz * 0.7), fabric, [px, py * 0.6, pz + sz * 0.08])
    // Cushion
    this._addMesh(new THREE.BoxGeometry(sx * 0.85, sy * 0.15, sz * 0.55), fabric, [px, py + sy * 0.05, pz + sz * 0.1])
    // Back
    this._addMesh(new THREE.BoxGeometry(sx, sy * 0.65, sz * 0.15), dark, [px, py + sy * 0.25, pz - sz * 0.38])
    // Arms
    for (const s of [-1, 1]) {
      this._addMesh(new THREE.BoxGeometry(0.1, sy * 0.4, sz * 0.7), dark, [px + s * (sx / 2), py + sy * 0.05, pz + sz * 0.05])
    }
    // Legs
    const legMat = this._mat('#3a2a1a', { roughness: 0.4 })
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        this._addMesh(
          new THREE.CylinderGeometry(0.02, 0.015, 0.1, 8),
          legMat, [px + dx * (sx / 2 - 0.06), 0.05, pz + dz * (sz / 2 - 0.06)]
        )
      }
    }
  }

  _buildTable(item) {
    const [sx, sy, sz] = item.size
    const [px, py, pz] = item.position
    const woodMat = this._mat(item.color, { roughness: 0.45, clearcoat: 0.2, clearcoatRoughness: 0.4 })
    const legMat = this._mat(item.color, { roughness: 0.5, metalness: 0.1 })

    const topThickness = 0.04
    // Table top
    this._addMesh(
      new THREE.BoxGeometry(sx, topThickness, sz),
      woodMat, [px, py, pz]
    )

    // Legs (tapered)
    const legH = py - topThickness / 2
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        this._addMesh(
          new THREE.CylinderGeometry(0.025, 0.02, legH, 8),
          legMat,
          [px + dx * (sx / 2 - 0.06), legH / 2, pz + dz * (sz / 2 - 0.06)]
        )
      }
    }
  }

  _buildChair(item) {
    const [sx, sy, sz] = item.size
    const [px, py, pz] = item.position
    const woodMat = this._mat(item.color, { roughness: 0.5, clearcoat: 0.15 })

    // Seat
    this._addMesh(new THREE.BoxGeometry(sx, 0.03, sz), woodMat, [px, py * 0.55, pz])
    // Back
    this._addMesh(new THREE.BoxGeometry(sx * 0.9, sy * 0.5, 0.025), woodMat, [px, py + sy * 0.1, pz - sz / 2 + 0.02])
    // Legs
    const legH = py * 0.55
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        this._addMesh(
          new THREE.CylinderGeometry(0.015, 0.015, legH, 6),
          woodMat, [px + dx * (sx / 2 - 0.04), legH / 2, pz + dz * (sz / 2 - 0.04)]
        )
      }
    }
  }

  _buildBed(item) {
    const [sx, sy, sz] = item.size
    const [px, py, pz] = item.position

    const frameMat = this._mat('#8b7355', { roughness: 0.5, clearcoat: 0.15 })
    const sheetMat = this._mat('#f0ece6', { roughness: 0.95 })
    const blanketMat = this._mat('#b8c4d4', { roughness: 0.93 })
    const pillowMat = this._mat('#f5f2ed', { roughness: 0.96 })

    // Frame
    this._addMesh(new THREE.BoxGeometry(sx + 0.1, sy * 0.4, sz + 0.05), frameMat, [px, sy * 0.2, pz])

    // Mattress
    this._addMesh(new THREE.BoxGeometry(sx, sy * 0.25, sz), sheetMat, [px, sy * 0.52, pz])

    // Sheet (slightly draped)
    this._addMesh(new THREE.BoxGeometry(sx + 0.04, 0.02, sz * 0.65), sheetMat, [px, sy * 0.66, pz + sz * 0.15])

    // Blanket (folded at foot)
    this._addMesh(new THREE.BoxGeometry(sx, 0.06, sz * 0.4), blanketMat, [px, sy * 0.68, pz + sz * 0.28])

    // Pillows
    for (const dx of [-0.35, 0.35]) {
      this._addMesh(
        new THREE.BoxGeometry(0.5, 0.12, 0.35),
        pillowMat, [px + dx, sy * 0.72, pz - sz * 0.32]
      )
    }
  }

  _buildCabinet(item) {
    const [sx, sy, sz] = item.size
    const [px, py, pz] = item.position
    const woodMat = this._mat(item.color, { roughness: 0.55, clearcoat: 0.1 })
    const handleMat = this._mat('#888', { metalness: 0.6, roughness: 0.3 })

    // Body
    this._addMesh(new THREE.BoxGeometry(sx, sy, sz), woodMat, [px, py, pz])

    // Top surface (slightly different shade)
    this._addMesh(
      new THREE.BoxGeometry(sx + 0.01, 0.02, sz + 0.01),
      this._mat(new THREE.Color(item.color).offsetHSL(0, 0, 0.03), { roughness: 0.4, clearcoat: 0.2 }),
      [px, py + sy / 2 + 0.01, pz]
    )

    // Handles
    const handleCount = Math.max(1, Math.round(sy / 0.5))
    for (let i = 0; i < handleCount; i++) {
      const hy = py - sy / 2 + (sy / (handleCount + 1)) * (i + 1)
      this._addMesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.08, 6),
        handleMat,
        [px + sx / 2 + 0.01, hy, pz],
        { rotation: [0, 0, Math.PI / 2] }
      )
    }

    // Legs
    const legH = 0.08
    const legMat = this._mat('#555', { metalness: 0.3 })
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        this._addMesh(
          new THREE.CylinderGeometry(0.015, 0.015, legH, 6),
          legMat,
          [px + dx * (sx / 2 - 0.04), py - sy / 2 + legH / 2 - sy / 2 + sy / 2, pz + dz * (sz / 2 - 0.04)]
        )
      }
    }
  }

  _buildPlant(item) {
    const [, , ] = item.size
    const [px, py, pz] = item.position

    // Pot
    const potMat = this._mat('#c4a882', { roughness: 0.7 })
    this._addMesh(
      new THREE.CylinderGeometry(0.15, 0.12, 0.25, 12),
      potMat, [px, 0.125, pz]
    )

    // Soil
    this._addMesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.03, 12),
      this._mat('#3a2a1a'), [px, 0.26, pz]
    )

    // Leaves (multiple cones at angles)
    const leafMat = this._mat('#4a7c59', { roughness: 0.85 })
    const leafCount = 7
    for (let i = 0; i < leafCount; i++) {
      const angle = (i / leafCount) * Math.PI * 2
      const tilt = 0.2 + Math.random() * 0.4
      const h = 0.4 + Math.random() * 0.4
      const leaf = this._addMesh(
        new THREE.ConeGeometry(0.08, h, 6),
        leafMat,
        [px + Math.sin(angle) * 0.06, 0.35 + h / 2, pz + Math.cos(angle) * 0.06],
        { rotation: [tilt * Math.cos(angle), angle, tilt * Math.sin(angle)] }
      )
    }

    // Central tall leaf
    this._addMesh(
      new THREE.ConeGeometry(0.1, 0.7, 8),
      this._mat('#3a6b49', { roughness: 0.85 }),
      [px, 0.65, pz]
    )
  }

  _buildLamp(item) {
    const [, , ] = item.size
    const [px, , pz] = item.position

    // Base
    this._addMesh(
      new THREE.CylinderGeometry(0.12, 0.15, 0.03, 16),
      this._mat('#888', { metalness: 0.5, roughness: 0.2 }),
      [px, 0.015, pz]
    )

    // Pole
    this._addMesh(
      new THREE.CylinderGeometry(0.015, 0.015, 1.2, 8),
      this._mat('#aaa', { metalness: 0.6, roughness: 0.2 }),
      [px, 0.63, pz]
    )

    // Shade
    this._addMesh(
      new THREE.CylinderGeometry(0.12, 0.18, 0.25, 16, 1, true),
      this._mat('#f5e6d0', { roughness: 0.9, side: THREE.DoubleSide }),
      [px, 1.35, pz]
    )

    // Light inside shade
    const lampLight = new THREE.PointLight('#fff0d0', 0.5, 3, 2)
    lampLight.position.set(px, 1.3, pz)
    this.scene.add(lampLight)
  }

  _buildTV(item) {
    const [sx, sy, sz] = item.size
    const [px, py, pz] = item.position

    // Screen
    this._addMesh(
      new THREE.BoxGeometry(sz, sy, sx),
      this._mat('#0a0a0a', { roughness: 0.05, metalness: 0.1 }),
      [px, py, pz]
    )

    // Screen bezel
    this._addMesh(
      new THREE.PlaneGeometry(sz - 0.05, sy - 0.04),
      this._mat('#1a1a2e', { roughness: 0.1, metalness: 0.05, envIntensity: 0.4 }),
      [px - sx / 2 - 0.001, py, pz]
    )

    // Stand
    this._addMesh(
      new THREE.BoxGeometry(0.04, 0.3, 0.2),
      this._mat('#333', { metalness: 0.5 }),
      [px, py - sy / 2 - 0.15, pz]
    )
    this._addMesh(
      new THREE.BoxGeometry(0.04, 0.02, 0.4),
      this._mat('#333', { metalness: 0.5 }),
      [px, py - sy / 2 - 0.3, pz]
    )
  }

  _buildBox(item, matOpts = {}) {
    const [sx, sy, sz] = item.size
    const [px, py, pz] = item.position
    this._addMesh(
      new THREE.BoxGeometry(sx, sy, sz),
      this._mat(item.color, matOpts),
      [px, py, pz]
    )
  }

  // ─── Carpet ───

  loadCarpetTexture(imageSource) {
    return new Promise((resolve, reject) => {
      const applyTexture = (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        texture.minFilter = THREE.LinearMipmapLinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
        this._lastCarpetTexture = texture
        this._createCarpetMesh(texture)
        resolve()
      }

      if (imageSource instanceof File) {
        const reader = new FileReader()
        reader.onload = (e) => {
          new THREE.TextureLoader().load(e.target.result, applyTexture, undefined, reject)
        }
        reader.readAsDataURL(imageSource)
      } else {
        new THREE.TextureLoader().load(imageSource, applyTexture, undefined, reject)
      }
    })
  }

  _createCarpetMesh(texture) {
    if (this.carpet) {
      this.scene.remove(this.carpet)
      this.carpet.geometry.dispose()
      this.carpet.material.dispose()
    }

    const { width, height } = this.carpetSize
    const geo = new THREE.PlaneGeometry(width, height, 1, 1)
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
      envMap: this.envMap,
      envMapIntensity: 0.05
    })

    this.carpet = new THREE.Mesh(geo, mat)
    this.carpet.rotation.x = -Math.PI / 2
    this.carpet.rotation.z = THREE.MathUtils.degToRad(this.carpetRotation)

    // Keep old position if exists, else default
    if (this._lastCarpetPos) {
      this.carpet.position.copy(this._lastCarpetPos)
    } else {
      this.carpet.position.set(...CARPET_DEFAULTS.position)
    }

    this.carpet.receiveShadow = true
    this.carpet.name = 'carpet'
    this.scene.add(this.carpet)

    // Contact shadow under carpet (subtle dark plane)
    this._addCarpetShadow(width, height)
  }

  _addCarpetShadow(w, h) {
    // Remove old shadow
    const old = this.scene.getObjectByName('carpetShadow')
    if (old) { this.scene.remove(old); old.geometry.dispose(); old.material.dispose() }

    const shadowMat = new THREE.MeshBasicMaterial({
      color: '#000000',
      transparent: true,
      opacity: 0.08,
      depthWrite: false
    })
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.02, h + 0.02), shadowMat)
    shadow.rotation.x = -Math.PI / 2
    shadow.position.set(
      this.carpet.position.x,
      0.001,
      this.carpet.position.z
    )
    shadow.rotation.z = this.carpet.rotation.z
    shadow.name = 'carpetShadow'
    this.scene.add(shadow)
  }

  setCarpetSize(widthCm, heightCm) {
    this.carpetSize.width = widthCm / 100
    this.carpetSize.height = heightCm / 100
    if (this.carpet) {
      this._lastCarpetPos = this.carpet.position.clone()
    }
    if (this.carpet && this._lastCarpetTexture) {
      this._createCarpetMesh(this._lastCarpetTexture)
    }
  }

  setCarpetRotation(deg) {
    this.carpetRotation = deg
    if (this.carpet) {
      this.carpet.rotation.z = THREE.MathUtils.degToRad(deg)
      const shadow = this.scene.getObjectByName('carpetShadow')
      if (shadow) shadow.rotation.z = this.carpet.rotation.z
    }
  }

  setCameraPreset(preset) {
    if (!this.currentRoom) return
    const { width, depth } = this.currentRoom.dimensions

    const presets = {
      front: { pos: [0, 1.6, depth / 2 + 2], target: [0, 0, 0] },
      angle: { pos: [width / 2 + 1, 2.2, depth / 2 + 1], target: [0, 0, -0.5] },
      top: { pos: [0, 5, 0.5], target: [0, 0, 0] },
      low: { pos: [2, 0.6, depth / 2 + 1.5], target: [0, 0.2, -0.5] }
    }

    const p = presets[preset]
    if (!p) return

    const startPos = this.camera.position.clone()
    const endPos = new THREE.Vector3(...p.pos)
    const startTarget = this.controls.target.clone()
    const endTarget = new THREE.Vector3(...p.target)

    let t = 0
    const animate = () => {
      t += 0.025
      if (t > 1) t = 1
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

      this.camera.position.lerpVectors(startPos, endPos, ease)
      this.controls.target.lerpVectors(startTarget, endTarget, ease)
      this.controls.update()

      if (t < 1) requestAnimationFrame(animate)
    }
    animate()
  }

  // ─── Carpet Drag ───

  _setupDrag() {
    const canvas = this.renderer.domElement
    const intersectPoint = new THREE.Vector3()

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.carpet) return
      this._updateMouse(e)
      this.raycaster.setFromCamera(this.mouse, this.camera)

      const hits = this.raycaster.intersectObject(this.carpet)
      if (hits.length > 0) {
        this.isDraggingCarpet = true
        this.controls.enabled = false
        this.raycaster.ray.intersectPlane(this.dragPlane, intersectPoint)
        this.dragOffset.copy(this.carpet.position).sub(intersectPoint)
        canvas.style.cursor = 'move'
      }
    })

    canvas.addEventListener('pointermove', (e) => {
      if (!this.isDraggingCarpet) return
      this._updateMouse(e)
      this.raycaster.setFromCamera(this.mouse, this.camera)
      this.raycaster.ray.intersectPlane(this.dragPlane, intersectPoint)
      this.carpet.position.x = intersectPoint.x + this.dragOffset.x
      this.carpet.position.z = intersectPoint.z + this.dragOffset.z

      // Move shadow too
      const shadow = this.scene.getObjectByName('carpetShadow')
      if (shadow) {
        shadow.position.x = this.carpet.position.x
        shadow.position.z = this.carpet.position.z
      }
    })

    canvas.addEventListener('pointerup', () => {
      if (this.isDraggingCarpet) {
        this.isDraggingCarpet = false
        this.controls.enabled = true
        canvas.style.cursor = 'grab'
        this._lastCarpetPos = this.carpet.position.clone()
      }
    })
  }

  _updateMouse(e) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  }

  // Public getters for AR module
  getCarpetTexture() { return this._lastCarpetTexture }
  getCarpetSize() { return { ...this.carpetSize } }

  destroy() {
    window.removeEventListener('resize', this._onResize)
    this.renderer.dispose()
    this.controls.dispose()
  }
}
