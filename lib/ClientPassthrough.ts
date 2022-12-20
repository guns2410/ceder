import { PassThrough, TransformOptions } from 'node:stream'

interface PassThroughOptions extends TransformOptions {
  objectMode?: boolean;
}

export class ClientPassThrough extends PassThrough {

  constructor(options?: PassThroughOptions) {
    super(options)
  }

  json<T = unknown>(): Promise<T> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      this.on('data', (chunk: Buffer) => chunks.push(chunk))
      this.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString())
          resolve(json)
        } catch (err) {
          reject(err)
        }
      })
    })
  }

  text(): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      this.on('data', (chunk) => chunks.push(chunk))
      this.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString()
          resolve(text)
        } catch (err) {
          reject(err)
        }
      })
    })
  }

  stream(): Promise<NodeJS.ReadableStream> {
    return new Promise((resolve, reject) => {
      this.on('error', (err) => reject(err))
      resolve(this)
    })
  }
}
