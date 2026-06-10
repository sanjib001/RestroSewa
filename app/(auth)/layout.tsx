export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="login-theme min-h-screen bg-background text-foreground">
      {children}
    </div>
  )
}
