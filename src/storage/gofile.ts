import { CombineStream } from '../combineStream.js'

export async function uploadGofile(
  file: Blob | string,
  filename?: string
): Promise<string>
export async function uploadGofile(
  file: ReadableStream<Uint8Array>,
  filename: string | undefined,
  length: number
): Promise<string>
export async function uploadGofile(
  file: ReadableStream<Uint8Array> | Blob | string,
  filename: string = 'file',
  length?: number
): Promise<string> {
  // https://gofile.io/api

  if (typeof file === 'string') {
    file = new Blob([file], { type: 'text/plain' })
  }
  let request: Request
  if (file instanceof Blob) {
    const formData = new FormData()
    formData.append('file', file, filename)
    request = new Request('https://upload.gofile.io/uploadFile', {
      method: 'POST',
      body: formData,
    })
  } else if (file instanceof ReadableStream) {
    if (length === undefined) {
      throw new Error('Length must be provided for ReadableStream uploads')
    }

    const boundary = '-'.repeat(20) + Math.random().toFixed(20).slice(2)

    const prefix = `--${boundary}
Content-Disposition: form-data; name="file"; filename="${filename}"
Content-Type: application/octet-stream

`.replaceAll(/\r?\n/g, '\r\n')
    const suffix = `\r\n--${boundary}--\r\n`

    const combinedStream = CombineStream([
      prefix,
      { stream: file, length },
      suffix,
    ])

    request = new Request('https://upload.gofile.io/uploadFile', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: combinedStream,
    })
  } else {
    throw new Error('Unsupported file type. Must be Blob or ReadableStream.')
  }

  console.log('Uploading to Gofile:', request.url)
  const response = await fetch(request)
  if (!response.ok) {
    throw new Error(`Failed to upload file: ${response.statusText}`)
  }

  const json = (await response.json()) as any
  const downloadPage = json?.data?.downloadPage
  if (typeof downloadPage !== 'string') {
    throw new Error('Invalid response from Gofile: missing downloadPage')
  }
  return downloadPage
}

export async function downloadGofile(
  url: string,
  headers: HeadersInit = {}
): Promise<Response> {
  // We must obtain a guest token from the accounts endpoint,
  // then use that token and the webToken from the global.js script
  // to access the contents route. Accessing the contents route
  // with a token also authorizes that token to download the file
  // from the direct link.

  const folderCode = url.replace('https://gofile.io/d/', '')

  const accountsResponse = await fetch('https://api.gofile.io/accounts', {
    method: 'POST',
  })
  if (!accountsResponse.ok) {
    throw new Error(
      `Failed to get account token: ${accountsResponse.statusText}`
    )
  }
  const accountsJson = (await accountsResponse.json()) as any
  const token = accountsJson?.data?.token
  if (typeof token !== 'string') {
    throw new Error('Invalid response from Gofile: missing token')
  }

  const script = await (
    await fetch('https://gofile.io/dist/js/global.js')
  ).text()
  const webToken = script.match(/appdata\.wt = "([^\n"]+)"/)?.[1]
  if (!webToken) {
    throw new Error('Failed to extract web token from Gofile script')
  }

  const contentsURL = `https://api.gofile.io/contents/${folderCode}?wt=${webToken}`
  const contentsResult = await fetch(contentsURL, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  if (!contentsResult.ok) {
    throw new Error(`Failed to get contents: ${contentsResult.statusText}`)
  }

  const contentsJson = (await contentsResult.json()) as any
  const files = contentsJson?.data?.children
  if (!files || typeof files !== 'object' || Object.keys(files).length === 0) {
    throw new Error('No files found in Gofile contents')
  }
  const firstFile = Object.values(files)[0] as any
  if (!firstFile || !firstFile.link) {
    throw new Error('No valid file link found in Gofile contents')
  }
  const downloadUrl = firstFile.link as string

  const downloadHeaders = new Headers(headers)
  downloadHeaders.set('Cookie', `accountToken=${token}`)
  const fileResponse = await fetch(downloadUrl, {
    headers: downloadHeaders,
  })

  return fileResponse
}
