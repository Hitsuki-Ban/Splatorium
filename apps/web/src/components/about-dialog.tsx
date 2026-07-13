import thirdPartyLicenses from '../../../../third-party-licenses.md?raw'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { PRODUCT_NAME, PRODUCT_VERSION, REPOSITORY_URL } from '@/lib/product-info'
import { ExternalLink, Info } from 'lucide-react'
import { useState } from 'react'

export function AboutDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label={`${PRODUCT_NAME} について`}
          title={`${PRODUCT_NAME} について`}
        >
          <Info />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{PRODUCT_NAME}</DialogTitle>
          <DialogDescription>バージョン {PRODUCT_VERSION}</DialogDescription>
        </DialogHeader>

        <section className="rounded-lg border bg-accent/50 p-4 text-center">
          <p className="text-lg font-semibold">Built with DINOv3</p>
          <p className="mt-1 text-sm text-muted-foreground">
            DINOv3 Materials の利用には同梱の DINOv3 License が適用されます。
          </p>
        </section>

        <section className="min-h-0 space-y-2">
          <h3 className="text-sm font-semibold">サードパーティライセンス</h3>
          <div
            className="max-h-72 overflow-y-auto rounded-md border bg-muted/30 p-3"
            tabIndex={0}
            aria-label="サードパーティライセンス全文"
          >
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
              {thirdPartyLicenses}
            </pre>
          </div>
        </section>

        <a
          className="inline-flex w-fit max-w-full items-center gap-1.5 break-all text-sm text-primary underline-offset-4 hover:underline"
          href={REPOSITORY_URL}
          target="_blank"
          rel="noreferrer"
        >
          {REPOSITORY_URL}
          <ExternalLink className="size-3.5" />
        </a>
      </DialogContent>
    </Dialog>
  )
}
