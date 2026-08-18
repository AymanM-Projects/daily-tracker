import type { ReactNode } from 'react'

interface IconProps {
  size?: number
}

function Svg({ size = 16, children }: IconProps & { children: ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function CalendarIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </Svg>
  )
}

export function MoonIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </Svg>
  )
}

export function SunIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Svg>
  )
}

/** Routines — a fixed part of the day, distinct from the moon used for prayer. */
export function SunriseIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M12 3v4M5.6 8.6l1.4 1.4M2 15h2M20 15h2M17 10l1.4-1.4" />
      <path d="M8 15a4 4 0 0 1 8 0" />
      <path d="M3 19h18" />
    </Svg>
  )
}

export function RepeatIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </Svg>
  )
}

export function CheckSquareIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="m9 11 3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </Svg>
  )
}

export function ListIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </Svg>
  )
}

export function BookIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </Svg>
  )
}

export function PinIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
    </Svg>
  )
}

export function PlusIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M5 12h14M12 5v14" />
    </Svg>
  )
}

export function TrashIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  )
}

export function PencilIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </Svg>
  )
}

export function XIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  )
}

export function CheckIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  )
}

export function ChevronLeftIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  )
}

export function ChevronRightIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  )
}

export function ZapIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </Svg>
  )
}

export function CoffeeIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
      <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
      <path d="M6 2v2M10 2v2M14 2v2" />
    </Svg>
  )
}

export function AlertIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M21.73 18l-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4M12 17h.01" />
    </Svg>
  )
}

export function SettingsIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10.6 3V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15.6 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Svg>
  )
}

export function PlayIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M6 3.5v17l14-8.5z" />
    </Svg>
  )
}

export function PauseIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M9 4v16M15 4v16" />
    </Svg>
  )
}

export function SkipIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M5 4v16M19 4v16M8 12h8" />
    </Svg>
  )
}

export function ClockIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </Svg>
  )
}

export function SparklesIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M9.94 15.5a2 2 0 0 0-1.44-1.44L2.37 12.5a.5.5 0 0 1 0-.96l6.13-1.58A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0l1.58 6.13a2 2 0 0 0 1.44 1.44l6.13 1.58a.5.5 0 0 1 0 .96l-6.13 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z" />
      <path d="M20 3v4M22 5h-4" />
    </Svg>
  )
}

export function TargetIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </Svg>
  )
}

/** Projects — deliberately distinct from TargetIcon, which already means "Focus mode" elsewhere. */
export function FlagIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <path d="M4 22V3" />
    </Svg>
  )
}
