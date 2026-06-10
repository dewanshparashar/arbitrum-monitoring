/* Entry point — mounts the live fleet console. */

import React from 'react'
import { createRoot } from 'react-dom/client'
import { Console } from './components/Console.jsx'

createRoot(document.getElementById('root')).render(<Console />)
