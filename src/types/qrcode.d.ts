declare module 'qrcode' {
  interface QRCodeToStringOptions {
    type?: 'utf8' | 'svg' | 'terminal'
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
    margin?: number
    scale?: number
    width?: number
    color?: {
      dark?: string
      light?: string
    }
  }

  interface QRCodeToDataURLOptions extends QRCodeToStringOptions {
    rendererOpts?: {
      quality?: number
    }
  }

  export function toDataURL(
    text: string | Array<{ data: Buffer; mode: string }>,
    options?: QRCodeToDataURLOptions
  ): Promise<string>

  export function toString(
    text: string | Array<{ data: Buffer; mode: string }>,
    options?: QRCodeToStringOptions
  ): Promise<string>

  export function toCanvas(
    canvasElement: HTMLCanvasElement,
    text: string | Array<{ data: Buffer; mode: string }>,
    options?: QRCodeToStringOptions
  ): Promise<void>

  export function toFile(
    path: string,
    text: string | Array<{ data: Buffer; mode: string }>,
    options?: QRCodeToStringOptions
  ): Promise<void>

  const QRCode: {
    toDataURL: typeof toDataURL
    toString: typeof toString
    toCanvas: typeof toCanvas
    toFile: typeof toFile
  }

  export default QRCode
}
