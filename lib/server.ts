import * as net from 'node:net'
import * as EventEmitter from 'node:events'
import { DefaultServerHandlerOptions, SocketRequestData } from './types'
import { Socket } from './Socket'

export class Server extends EventEmitter {
  private server: net.Server

  constructor() {
    super()
    this.server = net.createServer({
      keepAlive: true,
      noDelay: true,
    })
    this.server.on('connection', (_sock) => {
      const socket = new Socket(_sock, true)
      socket.on('request', (request: SocketRequestData) => {
        this.emit(request.handlerName, request)
      })
      socket.on('timeout', () => {
        socket.rawSocket.destroy(new Error('Socket timeout'))
      })

      socket.on('error', (err) => {
        console.error(err)
      })
    })
  }

  handle<T extends DefaultServerHandlerOptions>(handlerName: string, handler: (req: T, res: Socket) => Promise<any>) {
    this.on(handlerName, async ({ socket, ...requestData }) => {
      try {
        const data = await handler(requestData, socket)
        if (data) {
          if (data.constructor.name === 'Object') {
            for await  (const [key, value] of Object.entries(data)) {
              await socket.send(key, value)
            }
          } else {
            await socket.send('data', data)
          }
        }

        process.nextTick(() => {
          socket.done()
        })
      } catch (err: any) {
        console.error(err)
        await socket.send({ isError: true, stack: err.stack, ...err })
        await socket.done()
      }
    })
  }

  listen(port: number, hostname = 'localhost', callback?: () => void) {
    this.server.listen(port, hostname, callback)
  }

  stop(callback?: () => void) {
    this.server.close(callback)
  }

}
