import { FleetDbLike, handleApiRequest } from './routes'

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
  fleetDb?: FleetDbLike
) => {
  const url = new URL(request.url)

  const apiResponse = await handleApiRequest({
    method: request.method,
    pathname: readPathname(url),
    fleetDb,
  })

  return new Response(JSON.stringify(apiResponse.body), {
    status: apiResponse.status,
    headers: jsonHeaders,
  })
}
