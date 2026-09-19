import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

export const IconHome = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M13.5 1.515a3 3 0 0 0-3 0L3 5.845a2 2 0 0 0-1 1.732V21a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-6h4v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7.577a2 2 0 0 0-1-1.732l-7.5-4.33z" />
  </svg>
)

export const IconSearch = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M10.533 1.279c-5.18 0-9.407 4.14-9.407 9.279s4.226 9.279 9.407 9.279c2.234 0 4.29-.77 5.907-2.058l4.353 4.353a1 1 0 1 0 1.414-1.414l-4.344-4.344a9.157 9.157 0 0 0 2.077-5.816c0-5.14-4.226-9.28-9.407-9.28zm-7.407 9.279c0-4.006 3.302-7.28 7.407-7.28s7.407 3.274 7.407 7.28-3.302 7.279-7.407 7.279-7.407-3.273-7.407-7.28z" />
  </svg>
)

export const IconLibrary = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M3 22a1 1 0 0 1-1-1V3a1 1 0 0 1 2 0v18a1 1 0 0 1-1 1zM15.6 2.3a1 1 0 0 0-1.2.1l-8 7a1 1 0 0 0 0 1.5l8 7a1 1 0 0 0 1.6-.8V3.2a1 1 0 0 0-.4-.9zM21 3a1 1 0 0 0-1 1v16a1 1 0 1 0 2 0V4a1 1 0 0 0-1-1z" />
  </svg>
)

export const IconUsers = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M14.5 8a3.5 3.5 0 1 0-7 0 3.5 3.5 0 0 0 7 0zM4 19.5c0-3.6 3.1-6 7-6s7 2.4 7 6V20H4v-.5zm14.2-6.3a4.8 4.8 0 0 1 2.8 4.3V20h-2v-.5c0-1.7-.6-3.2-1.6-4.3.3 0 .5 0 .8.05zM15.5 4.1a3.5 3.5 0 0 1 0 6.8 3.5 3.5 0 0 0 0-6.8z" />
  </svg>
)

export const IconDisc = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22zm0 15.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zM12 13a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
  </svg>
)

export const IconImage = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V5h14v14zm-4.5-6.5L12 15l-1.5-2L8 16h8l-1.5-3.5zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
  </svg>
)

export const IconPlay = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M7.05 3.606l13.49 7.788a.7.7 0 0 1 0 1.212L7.05 20.394A.7.7 0 0 1 6 19.788V4.212a.7.7 0 0 1 1.05-.606z" />
  </svg>
)

export const IconPause = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M5.7 3a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7H5.7zm10 0a.7.7 0 0 0-.7.7v16.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7h-2.6z" />
  </svg>
)

export const IconSkipNext = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M17.7 3a.7.7 0 0 0-.7.7v6.569L5.05 3.606A.7.7 0 0 0 4 4.212v15.576a.7.7 0 0 0 1.05.606L17 13.731V20.3a.7.7 0 0 0 .7.7h1.6a.7.7 0 0 0 .7-.7V3.7a.7.7 0 0 0-.7-.7h-1.6z" />
  </svg>
)

export const IconSkipPrev = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M6.3 3a.7.7 0 0 1 .7.7v6.569l11.95-6.663A.7.7 0 0 1 20 4.212v15.576a.7.7 0 0 1-1.05.606L7 13.731V20.3a.7.7 0 0 1-.7.7H4.7a.7.7 0 0 1-.7-.7V3.7a.7.7 0 0 1 .7-.7h1.6z" />
  </svg>
)

export const IconRepeat = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
  </svg>
)

export const IconShuffle = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M18.79 4.71a1 1 0 0 0-1.41 0l-2.12 2.12 1.41 1.41 2.12-2.12a1 1 0 0 0 0-1.41zM4 7h5.17l7.12 7.12-1.41 1.41L7.76 8.41H4a1 1 0 0 1 0-2zm14.79 8.17a1 1 0 0 0-1.41 1.41l2.12 2.12a1 1 0 0 0 1.41-1.41l-2.12-2.12zM4 17h3.76l2.53-2.53 1.41 1.41L9.17 18.41H4a1 1 0 1 1 0-2z" />
  </svg>
)

export const IconVolume = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M9.742 6.241a.75.75 0 0 1 .256.54v10.438a.75.75 0 0 1-1.256.54L4.99 14.5H2.75A.75.75 0 0 1 2 13.75v-3.5a.75.75 0 0 1 .75-.75H4.99l3.752-3.259a.75.75 0 0 1 1-.001zm6.358-.741a.75.75 0 0 1 1.06 0 7.5 7.5 0 0 1 0 10.606.75.75 0 1 1-1.06-1.06 6 6 0 0 0 0-8.486.75.75 0 0 1 0-1.06zm-2.475 2.475a.75.75 0 0 1 1.06 0 4 4 0 0 1 0 5.656.75.75 0 1 1-1.06-1.06 2.5 2.5 0 0 0 0-3.536.75.75 0 0 1 0-1.06z" />
  </svg>
)

export const IconMuted = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M13.86 5.47a.75.75 0 0 0-1.256-.54L8.852 8H6.75A.75.75 0 0 0 6 8.75v6.5c0 .414.336.75.75.75h2.102l3.752 3.07a.75.75 0 0 0 1.256-.54V5.47zM4.28 3.22a.75.75 0 0 0-1.06 1.06l16.5 16.5a.75.75 0 1 0 1.06-1.06L4.28 3.22z" />
  </svg>
)

export const IconMusic = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M6 3v12.235A3.5 3.5 0 1 0 8.5 18.5V8h9v6.235A3.5 3.5 0 1 0 20 17.5V3H6z" />
  </svg>
)

export const IconScene = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M12 2a10 10 0 1 0 10 10A10.01 10.01 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8.01 8.01 0 0 1-8 8zm0-14a1 1 0 0 0-1 1v4.59l-2.7 2.7a1 1 0 1 0 1.4 1.42l3-3A1 1 0 0 0 13 11V7a1 1 0 0 0-1-1z" />
  </svg>
)
