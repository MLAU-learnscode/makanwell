export function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2)
  const view = new DataView(buffer)
  let offset = 0
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, float32Array[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}

export function arrayBufferToBase64(arrayBuffer) {
  if (arrayBuffer instanceof Float32Array) {
    arrayBuffer = floatTo16BitPCM(arrayBuffer)
  } else if (arrayBuffer instanceof Int16Array) {
    arrayBuffer = arrayBuffer.buffer
  }
  let binary = ''
  const bytes = new Uint8Array(arrayBuffer)
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, [...chunk])
  }
  return btoa(binary)
}

export function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

const dataMap = new WeakMap()

export function normalizeArray(data, m, downsamplePeaks = false, memoize = false) {
  let cache, mKey, dKey
  if (memoize) {
    mKey = m.toString()
    dKey = downsamplePeaks.toString()
    cache = dataMap.has(data) ? dataMap.get(data) : {}
    dataMap.set(data, cache)
    cache[mKey] = cache[mKey] || {}
    if (cache[mKey][dKey]) {
      return cache[mKey][dKey]
    }
  }
  const n = data.length
  const result = new Array(m)
  if (m <= n) {
    result.fill(0)
    const count = new Array(m).fill(0)
    for (let i = 0; i < n; i++) {
      const index = Math.floor(i * (m / n))
      if (downsamplePeaks) {
        result[index] = Math.max(result[index], Math.abs(data[i]))
      } else {
        result[index] += Math.abs(data[i])
      }
      count[index]++
    }
    if (!downsamplePeaks) {
      for (let i = 0; i < result.length; i++) {
        result[i] = result[i] / count[i]
      }
    }
  } else {
    for (let i = 0; i < m; i++) {
      const index = (i * (n - 1)) / (m - 1)
      const low = Math.floor(index)
      const high = Math.ceil(index)
      const t = index - low
      if (high >= n) {
        result[i] = data[n - 1]
      } else {
        result[i] = data[low] * (1 - t) + data[high] * t
      }
    }
  }
  if (memoize) {
    cache[mKey][dKey] = result
  }
  return result
}
