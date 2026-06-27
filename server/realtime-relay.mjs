import { WebSocketServer } from 'ws'
import { RealtimeClient } from '@openai/realtime-api-beta'
import { REALTIME_MODEL } from './realtime-config.mjs'

export class RealtimeRelay {
  constructor(apiKey) {
    this.apiKey = apiKey
    this.wss = null
  }

  listen(port) {
    this.wss = new WebSocketServer({ port })
    this.wss.on('connection', this.connectionHandler.bind(this))
    console.log(`[realtime-relay] ws://localhost:${port} (model: ${REALTIME_MODEL})`)
  }

  async connectionHandler(ws) {
    const client = new RealtimeClient({ apiKey: this.apiKey })

    client.realtime.on('server.*', (event) => {
      ws.send(JSON.stringify(event))
    })
    client.realtime.on('close', () => ws.close())

    const messageQueue = []
    const messageHandler = (data) => {
      try {
        const event = JSON.parse(data)
        client.realtime.send(event.type, event)
      } catch (e) {
        console.error('[realtime-relay] bad client message:', e.message)
      }
    }

    ws.on('message', (data) => {
      if (!client.isConnected()) {
        messageQueue.push(data)
      } else {
        messageHandler(data)
      }
    })
    ws.on('close', () => client.disconnect())

    try {
      await client.realtime.connect({ model: REALTIME_MODEL })
      client.updateSession()
    } catch (e) {
      console.error(`[realtime-relay] OpenAI connect failed (${REALTIME_MODEL}):`, e.message)
      ws.close()
      return
    }

    while (messageQueue.length) {
      messageHandler(messageQueue.shift())
    }
  }
}
