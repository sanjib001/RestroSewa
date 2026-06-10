import Image from 'next/image'
import { notFound, redirect } from 'next/navigation'
import { getAuthUser, hasPermission } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export default async function QrPage({ params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params
  const user = await getAuthUser()
  if (!user || !hasPermission(user, 'MANAGE_TABLES')) redirect('/operations')

  const service = createServiceClient()
  const { data } = await service
    .from('restaurant_tables')
    .select('display_name, qr_token')
    .eq('id', tableId)
    .eq('restaurant_id', user.restaurantId!)
    .single()

  if (!data) notFound()

  const table = data as { display_name: string; qr_token: string }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const tableUrl = `${appUrl}/t/${table.qr_token}`
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&ecc=M&data=${encodeURIComponent(tableUrl)}`

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
      <h1 className="font-heading text-xl font-semibold text-foreground">{table.display_name}</h1>
      <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
        <Image src={qrSrc} alt={`QR code for ${table.display_name}`} width={300} height={300} unoptimized />
      </div>
      <p className="max-w-xs break-all text-center font-mono text-xs text-muted-foreground">{tableUrl}</p>
      <p className="text-xs text-muted-foreground">Right-click the QR code and save image to print.</p>
    </div>
  )
}
