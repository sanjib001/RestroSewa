// All monetary values are stored as integers (paise). e.g. ₹10.50 = 1050
export function formatMoney(paise: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(paise) / 100)
}

export function addMoney(a: number, b: number): number {
  return a + b
}

export function subtractMoney(a: number, b: number): number {
  return a - b
}

export function multiplyMoney(paise: number, factor: number): number {
  return Math.round(paise * factor)
}

export function percentOf(paise: number, percent: number): number {
  return Math.round((paise * percent) / 100)
}
