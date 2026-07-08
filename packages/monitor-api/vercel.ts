import { FleetDbLike, handleApiRequest } from './routes'

// The fleet API is public, read-only JSON — allow any origin so browser-based
// agents/tools (and LLM connectors) can fetch it cross-origin. See /llms.txt.
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
}

const jsonHeaders = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  ...corsHeaders,
}

const readPathname = (url: URL) => {
  const pathname = url.searchParams.get('pathname')
  return pathname || url.pathname
}

export const handleVercelRequest = async (
  request: Request,
  fleetDb?: FleetDbLike
) => {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

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
