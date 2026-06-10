import Link from 'next/link'

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="font-heading text-5xl font-bold text-foreground">403</h1>
      <p className="text-muted-foreground">
        You do not have permission to access this page.
      </p>
      <Link
        href="/"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        Go home
      </Link>
    </main>
  )
}
