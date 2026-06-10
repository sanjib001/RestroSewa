import { Button } from '@/components/ui/button'

export default function PlaygroundPage() {
  return (
    <main className="min-h-screen p-8 space-y-12">
      <header>
        <h1 className="font-heading text-3xl font-bold text-foreground">
          Design System Playground
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Visual test environment — development only
        </p>
      </header>

      {/* Colour palettes */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-semibold text-foreground">
          Staff Theme (default dark)
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Swatch label="background" className="bg-background border border-border" />
          <Swatch label="card" className="bg-card" />
          <Swatch label="primary" className="bg-primary" />
          <Swatch label="secondary" className="bg-secondary" />
          <Swatch label="muted" className="bg-muted" />
          <Swatch label="accent" className="bg-accent" />
          <Swatch label="destructive" className="bg-destructive" />
          <Swatch label="border" className="border-4 border-border" />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-heading text-lg font-semibold text-foreground">
          Customer Theme
        </h2>
        <div className="customer-theme grid grid-cols-2 gap-3 rounded-lg p-4 sm:grid-cols-4">
          <Swatch label="background" className="bg-background border border-border" />
          <Swatch label="card" className="bg-card" />
          <Swatch label="primary" className="bg-primary" />
          <Swatch label="secondary" className="bg-secondary" />
          <Swatch label="muted" className="bg-muted" />
          <Swatch label="accent" className="bg-accent" />
          <Swatch label="destructive" className="bg-destructive" />
          <Swatch label="border" className="border-4 border-border" />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-heading text-lg font-semibold text-foreground">
          Login Theme
        </h2>
        <div className="login-theme grid grid-cols-2 gap-3 rounded-lg p-4 sm:grid-cols-4">
          <Swatch label="background" className="bg-background border border-border" />
          <Swatch label="card" className="bg-card" />
          <Swatch label="primary" className="bg-primary" />
          <Swatch label="secondary" className="bg-secondary" />
          <Swatch label="muted" className="bg-muted" />
          <Swatch label="accent" className="bg-accent" />
          <Swatch label="destructive" className="bg-destructive" />
          <Swatch label="border" className="border-4 border-border" />
        </div>
      </section>

      {/* Typography */}
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-foreground">
          Typography
        </h2>
        <p className="font-sans text-base text-foreground">
          font-sans (Inter) — Body text for staff and admin surfaces
        </p>
        <p className="font-heading text-2xl font-bold text-foreground">
          font-heading (Outfit) — Display headings for staff and admin
        </p>
        <p className="font-serif text-2xl font-semibold text-foreground">
          font-serif (Fraunces) — Customer headings, warm and inviting
        </p>
        <p className="text-sm text-muted-foreground">
          text-muted-foreground — Secondary text, labels, timestamps
        </p>
      </section>

      {/* Buttons */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-semibold text-foreground">
          Buttons — Staff Theme
        </h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="default">Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button size="xs">XS</Button>
          <Button size="sm">SM</Button>
          <Button size="default">Default</Button>
          <Button size="lg">LG</Button>
        </div>
      </section>

      <section className="customer-theme space-y-4 rounded-lg p-4">
        <h2 className="font-serif text-lg font-semibold text-foreground">
          Buttons — Customer Theme
        </h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="default">Order Now</Button>
          <Button variant="secondary">View Menu</Button>
          <Button variant="outline">Cancel</Button>
          <Button variant="ghost">Ghost</Button>
        </div>
      </section>

      <section className="login-theme space-y-4 rounded-lg p-4">
        <h2 className="font-heading text-lg font-semibold text-foreground">
          Buttons — Login Theme
        </h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="default">Sign In</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
        </div>
      </section>
    </main>
  )
}

function Swatch({ label, className }: { label: string; className: string }) {
  return (
    <div className="space-y-1">
      <div className={`h-12 w-full rounded-md ${className}`} />
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
