import { MonitorStore } from 'storage'
import { handleApiRequest } from './routes'

const jsonHeaders = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
}

const readPathname = (url: URL) => {
  const pathname = url.searchParams.get('pathname')
  return pathname || url.pathname
}

export const handleVercelRequest = async (
  request: Request,
  store: MonitorStore
) => {
  const url = new URL(request.url)
  const searchParams = new URLSearchParams(url.searchParams)
  searchParams.delete('pathname')

  const apiResponse = await handleApiRequest({
    method: request.method,
    pathname: readPathname(url),
    searchParams,
    store,
  })

  return new Response(JSON.stringify(apiResponse.body), {
    status: apiResponse.status,
    headers: jsonHeaders,
  })
}
