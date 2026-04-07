import { RoomScene } from './scene.js'
import { ARMode } from './ar.js'
import { ROOMS, DEFAULT_ROOM } from './rooms.js'

class App {
  constructor() {
    this.scene = null
    this.ar = null
    this._init()
  }

  async _init() {
    const container = document.getElementById('canvas-container')
    this.scene = new RoomScene(container)
    this.ar = new ARMode()

    this._buildRoomSelector()
    this._bindCarpetControls()
    this._bindSizeControls()
    this._bindRotationControls()
    this._bindCameraPresets()

    // Load default room
    this.scene.loadRoom(DEFAULT_ROOM)
    this._setActiveRoom(DEFAULT_ROOM)

    // Load demo carpet
    this._loadDemoCarpet()

    // Check AR support
    await this._setupAR()

    // URL params (Shopify integration)
    this._checkUrlParams()

    document.getElementById('loading-overlay').classList.add('hidden')
  }

  // ─── AR ───

  async _setupAR() {
    const support = await this.ar.checkSupport()
    const arBtn = document.getElementById('ar-btn')
    const arHint = document.getElementById('ar-hint')

    if (support.webxr) {
      arHint.textContent = 'WebXR destekli — gerçek zemin algılama'
      arBtn.addEventListener('click', () => this._startAR('webxr'))
    } else if (support.camera) {
      arHint.textContent = 'Kamera modunda — halıyı odan üzerine yerleştir'
      arBtn.addEventListener('click', () => this._startAR('camera'))
    } else {
      arBtn.disabled = true
      arBtn.style.opacity = '0.5'
      arHint.textContent = 'AR bu cihazda desteklenmiyor'
    }

    // AR exit button
    document.getElementById('ar-exit')?.addEventListener('click', () => {
      this.ar.stop()
    })
  }

  async _startAR(mode) {
    const texture = this.scene.getCarpetTexture()
    if (!texture) {
      alert('Önce bir halı görseli yükle')
      return
    }

    const size = this.scene.getCarpetSize()
    const arContainer = document.getElementById('app')
    const overlay = document.getElementById('ar-overlay')

    if (mode === 'webxr') {
      overlay.classList.remove('hidden')
      const success = await this.ar.startWebXR(arContainer, texture, size, () => {
        overlay.classList.add('hidden')
      })
      if (!success) {
        overlay.classList.add('hidden')
        // Fallback to camera mode
        this._startAR('camera')
      }
    } else {
      await this.ar.startCameraOverlay(arContainer, texture, size, () => {
        // AR ended
      })
    }
  }

  // ─── Room Selector ───

  _buildRoomSelector() {
    const grid = document.getElementById('room-selector')
    grid.innerHTML = ''

    for (const [key, room] of Object.entries(ROOMS)) {
      const card = document.createElement('div')
      card.className = 'room-card'
      card.dataset.room = key
      card.innerHTML = `<span class="room-icon">${room.icon}</span>${room.name}`
      card.addEventListener('click', () => {
        this.scene.loadRoom(key)
        this._setActiveRoom(key)
      })
      grid.appendChild(card)
    }
  }

  _setActiveRoom(key) {
    document.querySelectorAll('.room-card').forEach((card) => {
      card.classList.toggle('active', card.dataset.room === key)
    })
  }

  // ─── Carpet Controls ───

  _bindCarpetControls() {
    const urlInput = document.getElementById('carpet-url')
    const loadBtn = document.getElementById('load-carpet-btn')

    loadBtn.addEventListener('click', () => {
      const url = urlInput.value.trim()
      if (url) this._loadCarpetFromUrl(url)
    })

    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadBtn.click()
    })

    document.getElementById('carpet-file').addEventListener('change', (e) => {
      const file = e.target.files[0]
      if (!file) return
      this._showLoading()
      this.scene.loadCarpetTexture(file).then(() => this._hideLoading()).catch(() => {
        this._hideLoading()
        alert('Görsel yüklenemedi')
      })
    })
  }

  _loadCarpetFromUrl(url) {
    this._showLoading()
    this.scene.loadCarpetTexture(url).then(() => this._hideLoading()).catch(() => {
      this._hideLoading()
      alert('Görsel yüklenemedi. CORS sorunu olabilir — dosya yüklemeyi deneyin.')
    })
  }

  // ─── Size Controls ───

  _bindSizeControls() {
    const widthSlider = document.getElementById('carpet-width')
    const heightSlider = document.getElementById('carpet-height')
    const widthVal = document.getElementById('carpet-width-val')
    const heightVal = document.getElementById('carpet-height-val')

    const updateSize = () => {
      widthVal.textContent = `${widthSlider.value}cm`
      heightVal.textContent = `${heightSlider.value}cm`
      this.scene.setCarpetSize(Number(widthSlider.value), Number(heightSlider.value))
    }

    widthSlider.addEventListener('input', updateSize)
    heightSlider.addEventListener('input', updateSize)

    document.querySelectorAll('.size-presets .btn-sm').forEach((btn) => {
      btn.addEventListener('click', () => {
        widthSlider.value = btn.dataset.w
        heightSlider.value = btn.dataset.h
        updateSize()
      })
    })
  }

  // ─── Rotation Controls ───

  _bindRotationControls() {
    const rotSlider = document.getElementById('carpet-rotation')
    const rotVal = document.getElementById('carpet-rotation-val')

    const updateRotation = (deg) => {
      rotSlider.value = deg
      rotVal.textContent = `${deg}°`
      this.scene.setCarpetRotation(Number(deg))
    }

    rotSlider.addEventListener('input', () => updateRotation(rotSlider.value))

    document.querySelectorAll('.rotation-presets .btn-sm').forEach((btn) => {
      btn.addEventListener('click', () => updateRotation(btn.dataset.rot))
    })
  }

  // ─── Camera Presets ───

  _bindCameraPresets() {
    document.querySelectorAll('.camera-presets .btn-sm').forEach((btn) => {
      btn.addEventListener('click', () => this.scene.setCameraPreset(btn.dataset.cam))
    })
  }

  // ─── Demo Carpet ───

  _loadDemoCarpet() {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 1024
    const ctx = canvas.getContext('2d')

    // Rich red background
    ctx.fillStyle = '#8B1A1A'
    ctx.fillRect(0, 0, 1024, 1024)

    // Outer border
    const bw = 70
    ctx.strokeStyle = '#D4A55A'
    ctx.lineWidth = bw
    ctx.strokeRect(bw / 2, bw / 2, 1024 - bw, 1024 - bw)

    // Inner border
    ctx.strokeStyle = '#1a1a3e'
    ctx.lineWidth = 12
    ctx.strokeRect(bw + 15, bw + 15, 1024 - (bw + 15) * 2, 1024 - (bw + 15) * 2)

    // Second inner border
    ctx.strokeStyle = '#D4A55A'
    ctx.lineWidth = 3
    ctx.strokeRect(bw + 30, bw + 30, 1024 - (bw + 30) * 2, 1024 - (bw + 30) * 2)

    const cx = 512, cy = 512

    // Central medallion
    ctx.save()
    ctx.translate(cx, cy)

    // Outer diamond
    ctx.fillStyle = '#D4A55A'
    ctx.beginPath()
    ctx.moveTo(0, -140)
    ctx.lineTo(140, 0)
    ctx.lineTo(0, 140)
    ctx.lineTo(-140, 0)
    ctx.closePath()
    ctx.fill()

    // Inner diamond
    ctx.fillStyle = '#8B1A1A'
    ctx.beginPath()
    ctx.moveTo(0, -90)
    ctx.lineTo(90, 0)
    ctx.lineTo(0, 90)
    ctx.lineTo(-90, 0)
    ctx.closePath()
    ctx.fill()

    // Innermost
    ctx.fillStyle = '#D4A55A'
    ctx.beginPath()
    ctx.moveTo(0, -40)
    ctx.lineTo(40, 0)
    ctx.lineTo(0, 40)
    ctx.lineTo(-40, 0)
    ctx.closePath()
    ctx.fill()

    ctx.restore()

    // Corner ornaments
    const corners = [[130, 130], [894, 130], [130, 894], [894, 894]]
    for (const [x, y] of corners) {
      ctx.fillStyle = '#D4A55A'
      ctx.beginPath()
      ctx.moveTo(x, y - 35)
      ctx.lineTo(x + 35, y)
      ctx.lineTo(x, y + 35)
      ctx.lineTo(x - 35, y)
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = '#8B1A1A'
      ctx.beginPath()
      ctx.arc(x, y, 12, 0, Math.PI * 2)
      ctx.fill()
    }

    // Repeating motifs in field
    for (let x = 200; x < 850; x += 100) {
      for (let y = 200; y < 850; y += 100) {
        const distFromCenter = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
        if (distFromCenter < 160 || distFromCenter > 350) continue

        ctx.fillStyle = '#D4A55A'
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(Math.PI / 4)
        ctx.fillRect(-6, -6, 12, 12)
        ctx.restore()
      }
    }

    // Border pattern (running motif)
    ctx.fillStyle = '#8B1A1A'
    for (let i = 0; i < 20; i++) {
      const pos = 100 + i * 45
      // Top border
      ctx.fillRect(pos, 25, 8, 20)
      // Bottom border
      ctx.fillRect(pos, 1024 - 45, 8, 20)
      // Left border
      ctx.fillRect(25, pos, 20, 8)
      // Right border
      ctx.fillRect(1024 - 45, pos, 20, 8)
    }

    const dataUrl = canvas.toDataURL('image/png')
    this.scene.loadCarpetTexture(dataUrl)
  }

  // ─── URL Params (Shopify) ───

  _checkUrlParams() {
    const params = new URLSearchParams(window.location.search)

    const image = params.get('image')
    if (image) {
      document.getElementById('carpet-url').value = image
      this._loadCarpetFromUrl(image)
    }

    const w = params.get('width')
    const h = params.get('height')
    if (w && h) {
      document.getElementById('carpet-width').value = w
      document.getElementById('carpet-height').value = h
      document.getElementById('carpet-width-val').textContent = `${w}cm`
      document.getElementById('carpet-height-val').textContent = `${h}cm`
      this.scene.setCarpetSize(Number(w), Number(h))
    }

    const room = params.get('room')
    if (room && ROOMS[room]) {
      this.scene.loadRoom(room)
      this._setActiveRoom(room)
    }
  }

  _showLoading() {
    document.getElementById('loading-overlay').classList.remove('hidden')
  }

  _hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden')
  }
}

new App()
