import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import JSZip from 'jszip'
import { blink } from '@/blink/client'
import { BlinkClientBoundary } from '@/components/BlinkClientBoundary'
import { ArrowRight, Check, ChevronRight, CircleAlert, CloudUpload, Download, FileArchive, FileCode2, FileSearch, Gauge, Leaf, LoaderCircle, LockKeyhole, ShieldCheck, Sparkles, Wrench, X } from 'lucide-react'
import { toast } from 'sonner'

type Finding = { severity: string; file: string; issue: string; recommendation: string }
type Review = { summary: string; compatibilityScore: number; findings: Finding[]; conversionSteps: string[] }

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'FS Mod Converter AI · FS22 to FS25' },
      { name: 'description', content: 'Use AI to review Farming Simulator 22 mods and prepare a focused FS25 conversion plan.' },
    ],
  }),
  component: Home,
})

function Home() {
  return <BlinkClientBoundary fallback={<main className="min-h-dvh bg-background" />}><ConverterApp /></BlinkClientBoundary>
}

function ConverterApp() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [zip, setZip] = useState<JSZip | null>(null)
  const [filename, setFilename] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [manifest, setManifest] = useState('')
  const [review, setReview] = useState<Review | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => blink.auth.onAuthStateChanged((state) => {
    setUser(state.user ? { id: state.user.id, email: state.user.email } : null)
    if (!state.isLoading) setAuthLoading(false)
  }), [])

  async function loadMod(file?: File) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('Choose a ZIP archive exported from your FS22 mod folder.')
      return
    }
    if (file.size > 250 * 1024 * 1024) {
      toast.error('This archive is over 250 MB. Choose a smaller mod package.')
      return
    }
    setBusy(true)
    setReview(null)
    try {
      const loaded = await JSZip.loadAsync(file)
      const paths = Object.keys(loaded.files).filter((path) => !loaded.files[path].dir)
      const descPath = paths.find((path) => path.split('/').slice(-1)[0]?.toLowerCase() === 'moddesc.xml')
      if (!descPath) throw new Error('Could not find modDesc.xml in this archive.')
      const candidates = paths.filter((path) => /\.(xml|lua|i3d)$/i.test(path))
      const prioritized = [descPath, ...candidates.filter((path) => path !== descPath)].slice(0, 8)
      const contents = await Promise.all(prioritized.map(async (path) => {
        const text = await loaded.file(path)!.async('string')
        return `FILE: ${path}\n${text.slice(0, 9000)}`
      }))
      setZip(loaded)
      setFilename(file.name)
      setFiles(paths)
      setManifest(contents.join('\n\n---\n\n'))
      toast.success(`Loaded ${paths.length} files. Your archive stays in this browser.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read this ZIP archive.')
      setZip(null)
      setFilename('')
      setFiles([])
      setManifest('')
    } finally {
      setBusy(false)
    }
  }

  async function generatePlan() {
    if (!user) {
      blink.auth.login(window.location.href)
      return
    }
    if (!manifest) return
    setBusy(true)
    setReview(null)
    try {
      const { object } = await blink.ai.generateObject({
        prompt: `You are an experienced Farming Simulator mod compatibility analyst. Review the provided FS22 mod metadata and source snippets for likely FS25 migration risks. Do not invent GIANTS API changes or claim certainty without evidence. Separate evidence from hypotheses, prioritize only actionable issues, and say when the provided files do not support a conclusion. This is a planning report only: never claim to have edited or tested the mod. Return a compatibility score from 0 to 100 as a rough metadata-based estimate, not a guarantee.\n\nReturn summary, compatibilityScore, findings (severity must be exactly critical, high, medium, low, or info), and conversionSteps. Keep each recommendation concise. If no issue is evident, explain what still needs manual testing.\n\nArchive: ${filename}\nFiles in archive: ${files.length}\n\n${manifest}`,
        schema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            compatibilityScore: { type: 'number' },
            findings: { type: 'array', items: { type: 'object', properties: {
              severity: { type: 'string' }, file: { type: 'string' }, issue: { type: 'string' }, recommendation: { type: 'string' },
            }, required: ['severity', 'file', 'issue', 'recommendation'] } },
            conversionSteps: { type: 'array', items: { type: 'string' } },
          },
          required: ['summary', 'compatibilityScore', 'findings', 'conversionSteps'],
        },
      })
      const data = object as Review
      const validSeverities = ['critical', 'high', 'medium', 'low', 'info']
      setReview({
        summary: String(data.summary || 'Review completed.'),
        compatibilityScore: Math.max(0, Math.min(100, Number(data.compatibilityScore) || 0)),
        findings: Array.isArray(data.findings) ? data.findings.map((item) => ({
          ...item, severity: validSeverities.includes(item.severity) ? item.severity : 'info',
        })) : [],
        conversionSteps: Array.isArray(data.conversionSteps) ? data.conversionSteps.map(String) : [],
      })
      toast.success('Your FS25 conversion plan is ready.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The AI review could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  function downloadPlan() {
    if (!review) return
    const content = ['# FS22 → FS25 conversion plan', '', `Source: ${filename}`, `Generated: ${new Date().toLocaleString()}`, `Estimated compatibility: ${review.compatibilityScore}/100`, '', review.summary, '', '## Findings', ...review.findings.map((item) => `- [${item.severity.toUpperCase()}] ${item.file}: ${item.issue}\n  Recommendation: ${item.recommendation}`), '', '## Suggested conversion steps', ...review.conversionSteps.map((step, index) => `${index + 1}. ${step}`), '', 'Note: This is an AI-generated review, not a modified or game-tested ZIP. Validate changes in GIANTS Editor and in-game.'].join('\n')
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `${filename.replace(/\.zip$/i, '')}-fs25-plan.md`
    anchor.click()
    URL.revokeObjectURL(href)
    toast.success('Conversion plan downloaded.')
  }

  function reset() {
    setZip(null); setFilename(''); setFiles([]); setManifest(''); setReview(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  if (authLoading) return <main className="flex min-h-dvh items-center justify-center bg-background"><LoaderCircle className="animate-spin text-primary" /></main>

  return (
    <main className="min-h-dvh overflow-hidden bg-background text-foreground">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <a href="#top" className="flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><Leaf size={22} /></span>
          <span><span className="block text-sm font-bold tracking-tight">Fieldnotes</span><span className="block font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">mod workshop</span></span>
        </a>
        {user ? <button onClick={() => blink.auth.logout()} className="rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold transition hover:border-primary/50">{user.email || 'Signed in'} · Sign out</button> : <button onClick={() => blink.auth.login(window.location.href)} className="rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold transition hover:border-primary/50">Team sign in <ArrowRight className="ml-2 inline" size={14} /></button>}
      </header>

      <section id="top" className="relative mx-auto grid max-w-7xl gap-12 px-5 pb-12 pt-10 sm:px-8 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:gap-8 lg:pb-20 lg:pt-16">
        <div className="relative z-10">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.16em] text-primary"><Sparkles size={13} /> FS22 → FS25 · AI-assisted</div>
          <h1 className="max-w-3xl font-serif text-5xl leading-[1.02] tracking-[-.04em] sm:text-6xl lg:text-[4.6rem]">Give your mods a <em className="text-primary">fresh start.</em></h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">Review a Farming Simulator 22 mod and get a practical FS25 compatibility plan your team can work through together.</p>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-xs text-muted-foreground"><span className="inline-flex items-center gap-2"><ShieldCheck size={15} className="text-primary" /> Your ZIP stays in your browser</span><span className="inline-flex items-center gap-2"><FileCode2 size={15} className="text-primary" /> XML & Lua review</span></div>
        </div>
        <div className="relative min-h-[280px] lg:min-h-[420px]">
          <div className="absolute inset-x-8 inset-y-5 -rotate-3 rounded-[2rem] border border-primary/15 bg-primary/5" />
          <div className="absolute inset-x-4 inset-y-2 rotate-2 rounded-[2rem] border border-accent/50 bg-accent/20" />
          <div className="absolute inset-0 overflow-hidden rounded-[2rem] border border-border bg-card shadow-xl shadow-primary/10">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_24%,color-mix(in_oklch,var(--primary)_18%,transparent),transparent_40%),linear-gradient(145deg,color-mix(in_oklch,var(--accent)_22%,var(--card)),var(--card)_65%)]" />
            <div className="absolute inset-x-0 bottom-0 h-2/3 bg-[linear-gradient(180deg,transparent,color-mix(in_oklch,var(--primary)_10%,transparent))]" />
            <div className="absolute right-8 top-8 flex size-16 items-center justify-center rounded-full border border-primary/20 bg-background/50 text-primary"><Gauge size={27} strokeWidth={1.4} /></div>
            <div className="absolute bottom-8 left-7 right-7 sm:bottom-10 sm:left-10 sm:right-10">
              <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.2em] text-primary"><span className="size-1.5 rounded-full bg-primary" /> Built for careful conversions</div>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {[['01','Inspect'],['02','Prioritize'],['03','Validate']].map(([num,label]) => <div key={num} className="rounded-2xl border border-border/80 bg-background/80 p-3 backdrop-blur sm:p-4"><span className="font-mono text-[10px] text-primary">{num}</span><p className="mt-2 text-sm font-semibold">{label}</p></div>)}
              </div>
              <p className="mt-5 max-w-sm text-sm leading-6 text-muted-foreground">A clear migration starting point, not a black-box promise.</p>
            </div>
            <div className="absolute left-8 top-10 size-24 rounded-full border border-primary/10 sm:left-12 sm:top-14 sm:size-36" />
            <div className="absolute left-[18%] top-[20%] size-2 rounded-full bg-accent" />
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 pb-16 sm:px-8 lg:grid-cols-[.92fr_1.08fr] lg:pb-24">
        <div className="rounded-[1.75rem] border border-border bg-card p-5 shadow-sm sm:p-7">
          <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Start a conversion</p><h2 className="mt-2 font-serif text-2xl">Bring in an FS22 mod</h2></div><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><FileArchive size={19} /></span></div>
          <div onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void loadMod(event.dataTransfer.files[0]) }} className={`mt-6 rounded-2xl border border-dashed p-6 text-center transition sm:p-8 ${dragging ? 'border-primary bg-primary/10' : 'border-primary/35 bg-background/65'}`}>
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><CloudUpload size={23} /></span>
            <p className="mt-4 font-semibold">Drop your mod ZIP here</p>
            <p className="mt-1 text-sm text-muted-foreground">or choose it from your device · up to 250 MB</p>
            <input ref={inputRef} className="sr-only" type="file" accept=".zip,application/zip" onChange={(event) => void loadMod(event.target.files?.[0])} />
            <button onClick={() => inputRef.current?.click()} disabled={busy} className="mt-5 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md transition hover:scale-[1.02] hover:shadow-lg active:scale-[.98] disabled:opacity-60">{busy && !review ? 'Reading archive…' : 'Choose ZIP file'} <ChevronRight size={16} className="ml-2 inline" /></button>
          </div>
          {filename && zip && <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/45 p-3"><div className="flex min-w-0 items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-background text-primary"><FileCode2 size={18} /></span><div className="min-w-0"><p className="truncate text-sm font-semibold">{filename}</p><p className="text-xs text-muted-foreground">{files.length} files · modDesc.xml found</p></div></div><button aria-label="Remove archive" onClick={reset} className="rounded-lg p-2 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"><X size={16} /></button></div>}
          <button onClick={() => void generatePlan()} disabled={!zip || busy || authLoading} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-accent px-5 py-3.5 text-sm font-bold text-accent-foreground shadow-sm transition hover:scale-[1.01] hover:shadow-md active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-50">{busy && manifest ? <><LoaderCircle size={17} className="animate-spin" /> Reviewing mod files…</> : <><Sparkles size={17} /> Generate FS25 conversion plan <ArrowRight size={16} /></>}</button>
          {!user && <p className="mt-3 text-center text-xs text-muted-foreground"><LockKeyhole className="mr-1 inline" size={12} /> Team sign-in is required for AI review.</p>}
          <p className="mt-4 text-center text-[11px] leading-5 text-muted-foreground">Only selected text-based mod files are sent for AI review. The ZIP itself stays on this device.</p>
        </div>

        <div className="rounded-[1.75rem] border border-border bg-card p-5 shadow-sm sm:p-7">
          {review ? <ReviewPanel review={review} filename={filename} onDownload={downloadPlan} /> : <>
            <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Your review</p><h2 className="mt-2 font-serif text-2xl">The road to FS25</h2></div><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><FileSearch size={19} /></span></div>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">Start with the mod manifest and source files. The AI review highlights migration risks, suggests next steps, and gives your team a shareable checklist.</p>
            <div className="mt-6 space-y-3">
              {[
                ['01','Upload the mod ZIP','The archive is unpacked locally; the app checks for modDesc.xml.'],
                ['02','Review compatibility clues','AI reviews a small selection of XML and Lua text for likely FS25 issues.'],
                ['03','Share the conversion plan','Download a Markdown checklist, then verify changes in GIANTS Editor and in game.'],
              ].map(([num,title,description]) => <div key={num} className="flex gap-4 rounded-xl border border-border/75 bg-background/55 p-4"><span className="font-mono text-xs text-primary">{num}</span><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div><Check className="ml-auto mt-0.5 shrink-0 text-primary/70" size={16} /></div>)}
            </div>
            <div className="mt-5 flex gap-3 rounded-xl bg-accent/30 p-4 text-xs leading-5 text-secondary-foreground"><CircleAlert size={17} className="mt-0.5 shrink-0 text-primary" /><p>AI recommendations are a starting point. This tool does not rewrite or certify game assets; use the official editor and an in-game test before sharing a converted mod.</p></div>
          </>}
        </div>
      </section>
      <footer className="border-t border-border/70"><div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8"><span>Fieldnotes Mod Workshop · made for mod teams</span><span>Keep the original ZIP as your backup.</span></div></footer>
    </main>
  )
}

function ReviewPanel({ review, filename, onDownload }: { review: Review; filename: string; onDownload: () => void }) {
  const level = review.compatibilityScore >= 75 ? 'Promising start' : review.compatibilityScore >= 45 ? 'Needs a closer look' : 'Several risks to review'
  return <>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">AI compatibility review</p><h2 className="mt-2 font-serif text-2xl">Plan for this mod</h2><p className="mt-1 max-w-sm truncate text-xs text-muted-foreground">{filename}</p></div><div className="flex size-[4.5rem] flex-col items-center justify-center rounded-full border-4 border-primary/25 bg-primary/5"><span className="text-xl font-bold text-primary">{review.compatibilityScore}</span><span className="font-mono text-[8px] uppercase text-muted-foreground">estimate</span></div></div>
    <div className="mt-5 rounded-xl bg-secondary/60 p-4"><p className="text-sm font-semibold">{level}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{review.summary}</p></div>
    <div className="mt-5 flex items-center justify-between"><h3 className="text-sm font-bold">Findings <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{review.findings.length}</span></h3><button onClick={onDownload} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-primary transition hover:bg-primary/10"><Download size={14} /> Export plan</button></div>
    <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">{review.findings.length ? review.findings.map((item, index) => <article key={`${item.file}-${index}`} className="rounded-xl border border-border/80 bg-background/60 p-3"><div className="flex items-start gap-2"><span className={`mt-1 size-2 shrink-0 rounded-full ${item.severity === 'critical' || item.severity === 'high' ? 'bg-destructive' : item.severity === 'medium' ? 'bg-accent' : 'bg-primary/60'}`} /><div><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{item.severity}</span><span className="font-mono text-[10px] text-primary">{item.file}</span></div><p className="mt-1 text-sm font-medium">{item.issue}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.recommendation}</p></div></div></article>) : <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">No specific issues were identified in the files provided. Manual testing is still essential.</p>}</div>
    <div className="mt-5"><h3 className="text-sm font-bold">Suggested next steps</h3><ol className="mt-3 space-y-2">{review.conversionSteps.map((step, index) => <li key={index} className="flex gap-3 text-xs leading-5 text-muted-foreground"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 font-mono text-[10px] text-primary">{index + 1}</span>{step}</li>)}</ol></div>
    <div className="mt-5 flex gap-2 rounded-xl border border-accent/70 bg-accent/20 p-3 text-[11px] leading-5 text-secondary-foreground"><Wrench size={15} className="mt-0.5 shrink-0 text-primary" />This is an AI-generated estimate, not a modified ZIP or game test. Validate every change in GIANTS Editor and FS25.</div>
  </>
}
