import type { QRCodeData } from '../services/qrService'

type QrType = QRCodeData['type']

const PHRASES: Record<QrType, string> = {
  CLOCK_IN: 'the Clock In code',
  CLOCK_OUT: 'the Clock Out code',
  AREA: 'an area code',
  TASK: 'a task code',
  FEEDBACK: 'a feedback code',
}

export const isClockCode = (type: QrType | null | undefined): boolean =>
  type === 'CLOCK_IN' || type === 'CLOCK_OUT'

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * What to tell someone who scanned a real code on the wrong screen.
 *
 * This used to flash "Wrong QR type" for about a second and record nothing,
 * so a cleaner holding the Clock Out code up to the clock-in or area scanner
 * saw it apparently do nothing, and the missing clock-out was invisible.
 */
export function describeWrongQrType(scanned: QrType | null | undefined, allowed: QrType[]): string {
  const scannedPart = scanned
    ? `That is ${PHRASES[scanned]}.`
    : 'That code is not recognised.'
  const needed = allowed.map((type) => PHRASES[type]).join(' or ')
  return `${capitalise(scannedPart)} This screen needs ${needed}.`
}
