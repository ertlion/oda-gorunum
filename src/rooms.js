/**
 * Room presets — her oda: boyutlar, renkler, mobilya, kamera
 * Birimler: metre (Three.js units = metre)
 */

export const ROOMS = {
  modern: {
    name: 'Modern Salon',
    icon: '🛋️',
    dimensions: { width: 6, depth: 5, height: 3 },
    colors: {
      walls: '#f5f0e8',
      floor: '#c4a882',
      ceiling: '#fafafa',
      baseboard: '#d4cfc7'
    },
    floorType: 'parquet',
    camera: {
      position: [4.5, 2.2, 4.5],
      target: [0, 0, -0.5]
    },
    furniture: [
      {
        type: 'sofa',
        position: [-2.2, 0.4, -1.8],
        size: [2.2, 0.8, 0.9],
        color: '#6b7b8d'
      },
      {
        type: 'coffeeTable',
        position: [-0.5, 0.22, -0.8],
        size: [1.2, 0.44, 0.6],
        color: '#8b6f47'
      },
      {
        type: 'shelf',
        position: [2.7, 0.9, -2.2],
        size: [0.4, 1.8, 1.6],
        color: '#f0ebe3'
      },
      {
        type: 'plant',
        position: [2.5, 0, 1.8],
        size: [0.4, 1.2, 0.4],
        color: '#4a7c59'
      },
      {
        type: 'tv',
        position: [2.8, 1.2, -0.5],
        size: [0.08, 0.7, 1.2],
        color: '#1a1a1a'
      }
    ],
    windows: [
      {
        wall: 'back',
        position: [0, 1.5, -2.49],
        size: [2, 1.5]
      }
    ]
  },

  classic: {
    name: 'Klasik Salon',
    icon: '🏠',
    dimensions: { width: 7, depth: 5.5, height: 3.2 },
    colors: {
      walls: '#ede4d3',
      floor: '#9c7c5c',
      ceiling: '#f8f4ef',
      baseboard: '#7a6248'
    },
    floorType: 'parquet',
    camera: {
      position: [5, 2.5, 5],
      target: [0, 0, 0]
    },
    furniture: [
      {
        type: 'sofa',
        position: [-2.5, 0.4, -2],
        size: [2.4, 0.85, 1],
        color: '#8b4513'
      },
      {
        type: 'armchair',
        position: [1, 0.35, -2],
        size: [0.9, 0.7, 0.85],
        color: '#8b4513'
      },
      {
        type: 'coffeeTable',
        position: [-0.5, 0.25, -0.5],
        size: [1.4, 0.5, 0.8],
        color: '#5c3d1e'
      },
      {
        type: 'cabinet',
        position: [-3.2, 0.7, 0.5],
        size: [0.5, 1.4, 1.2],
        color: '#654321'
      },
      {
        type: 'lamp',
        position: [1, 0, -2],
        size: [0.3, 1.6, 0.3],
        color: '#d4af37'
      }
    ],
    windows: [
      {
        wall: 'right',
        position: [3.49, 1.6, -1],
        size: [1.4, 1.8]
      }
    ]
  },

  bedroom: {
    name: 'Yatak Odası',
    icon: '🛏️',
    dimensions: { width: 5, depth: 4.5, height: 2.8 },
    colors: {
      walls: '#e8e4df',
      floor: '#b89b7a',
      ceiling: '#f5f5f5',
      baseboard: '#c4b5a0'
    },
    floorType: 'parquet',
    camera: {
      position: [3.5, 2.2, 3.8],
      target: [-0.5, 0, -0.5]
    },
    furniture: [
      {
        type: 'bed',
        position: [-1, 0.3, -1.5],
        size: [1.8, 0.6, 2.2],
        color: '#ddd8d0'
      },
      {
        type: 'headboard',
        position: [-1, 0.8, -2.55],
        size: [1.9, 1, 0.1],
        color: '#8b7355'
      },
      {
        type: 'nightstand',
        position: [0.6, 0.25, -2],
        size: [0.5, 0.5, 0.4],
        color: '#a08060'
      },
      {
        type: 'nightstand',
        position: [-2.6, 0.25, -2],
        size: [0.5, 0.5, 0.4],
        color: '#a08060'
      },
      {
        type: 'wardrobe',
        position: [2.1, 1, 0],
        size: [0.6, 2, 1.8],
        color: '#f0ebe3'
      }
    ],
    windows: [
      {
        wall: 'back',
        position: [-1, 1.6, -2.24],
        size: [1.6, 1.3]
      }
    ]
  },

  diningRoom: {
    name: 'Yemek Odası',
    icon: '🍽️',
    dimensions: { width: 5.5, depth: 4.5, height: 3 },
    colors: {
      walls: '#f2ece2',
      floor: '#a88b6c',
      ceiling: '#fafafa',
      baseboard: '#c8b898'
    },
    floorType: 'parquet',
    camera: {
      position: [4, 2.4, 4],
      target: [0, 0, 0]
    },
    furniture: [
      {
        type: 'table',
        position: [0, 0.38, 0],
        size: [1.6, 0.76, 1],
        color: '#6b4e30'
      },
      {
        type: 'chair',
        position: [0, 0.4, 0.8],
        size: [0.45, 0.8, 0.45],
        color: '#5a4a3a'
      },
      {
        type: 'chair',
        position: [0, 0.4, -0.8],
        size: [0.45, 0.8, 0.45],
        color: '#5a4a3a'
      },
      {
        type: 'chair',
        position: [1, 0.4, 0],
        size: [0.45, 0.8, 0.45],
        color: '#5a4a3a'
      },
      {
        type: 'chair',
        position: [-1, 0.4, 0],
        size: [0.45, 0.8, 0.45],
        color: '#5a4a3a'
      },
      {
        type: 'sideboard',
        position: [-2.4, 0.45, -1.8],
        size: [1.8, 0.9, 0.5],
        color: '#7a5f3f'
      }
    ],
    windows: [
      {
        wall: 'left',
        position: [-2.74, 1.5, 0],
        size: [1.8, 1.5]
      }
    ]
  }
}

export const DEFAULT_ROOM = 'modern'

export const CARPET_DEFAULTS = {
  width: 2.0,
  height: 3.0,
  rotation: 0,
  position: [0, 0.005, 0]
}
