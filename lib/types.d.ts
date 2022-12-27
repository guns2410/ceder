import { TransformOptions } from 'node:stream'
import { Socket } from './Socket'

export type HandlerOptions = {
  returnMode?: 'stream' | 'buffer'
}

export interface SocketRequestData {
  handlerName: string
  transactionId: string
  data: any
  params: any
  socket: Socket
}

export type ClientConnectionOptions = {
  timeout?: number
  log?: boolean
}

export interface PassThroughOptions extends TransformOptions {
  objectMode?: boolean;
  log?: boolean;
}

export type DefaultServerHandlerOptions = {
  data: any
  params: { token: string }
}

export type SocketParsedData = {
  data?: any
  key?: string
  type?: number
  contentLength?: number
  dataLength?: number
  keyLength?: number
  isBodyParsed?: boolean
}
