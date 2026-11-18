type TProseVariant =
  | 'default'
  | 'compact'
  | 'handoff-document'
  | 'handoff-prompt'

const SHARED =
  'min-w-0 font-card wrap-anywhere [&_ul]:list-disc [&_ol]:list-decimal [&_table.md-table]:w-full! [&_table.md-table]:table-auto! [&_table.md-table]:border-collapse! [&_table.md-table]:my-3! [&_table.md-table]:text-sm! [&_table.md-table]:leading-relaxed! [&_table.md-table_th]:border-(length:--border-width)! [&_table.md-table_th]:border-border-soft! [&_table.md-table_th]:px-2.5! [&_table.md-table_th]:py-2! [&_table.md-table_th]:align-top! [&_table.md-table_th]:wrap-anywhere! [&_table.md-table_th]:bg-table-head! [&_table.md-table_th]:text-left! [&_table.md-table_th]:font-semibold! [&_table.md-table_td]:border-(length:--border-width)! [&_table.md-table_td]:border-border-soft! [&_table.md-table_td]:px-2.5! [&_table.md-table_td]:py-2! [&_table.md-table_td]:align-top! [&_table.md-table_td]:wrap-anywhere! [&_table.md-table_tbody_tr:nth-child(even)]:bg-zebra!'

const HANDOFF =
  'text-base/relaxed text-text [&_h1]:my-5 [&_h1]:text-3xl [&_h1]:leading-relaxed [&_h1]:font-bold [&_h2]:my-5 [&_h2]:text-2xl [&_h2]:leading-relaxed [&_h2]:font-bold [&_h3]:my-5 [&_h3]:text-lg [&_h3]:leading-relaxed [&_h3]:font-bold [&_h4]:my-5 [&_h4]:text-base [&_h4]:leading-relaxed [&_h4]:font-bold [&_p]:my-4 [&_ul]:my-4 [&_ul]:pl-10 [&_ol]:my-4 [&_ol]:pl-10 [&_blockquote]:mx-10 [&_blockquote]:my-4 [&_code]:font-mono [&_code]:text-sm [&_pre]:my-0 [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border-soft [&_pre]:bg-panel-3 [&_pre]:px-3.5 [&_pre]:py-3 [&_pre]:font-mono [&_pre]:text-base [&_pre]:leading-relaxed [&_pre]:text-dim [&_pre]:whitespace-pre-wrap [&_pre]:overflow-x-auto [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-text [&_hr]:my-2'

const VARIANT: Readonly<Record<TProseVariant, string>> = {
  'handoff-document': HANDOFF,
  'handoff-prompt': `${HANDOFF} rounded-xl border-(length:--border-width) border-border-soft bg-panel-2 px-4.5 py-4`,
  // Issue #171 SC3: unchanged appearance; the removed rule supplied the native code font.
  default:
    '[&_code]:[font-family:revert] text-base/relaxed text-text [&_h1]:mt-3.5 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:leading-relaxed [&_h1]:font-bold [&_h2]:mt-3.5 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:leading-relaxed [&_h2]:font-bold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-lg [&_h3]:leading-relaxed [&_h3]:font-bold [&_h4]:mt-3 [&_h4]:mb-1.5 [&_h4]:text-lg [&_h4]:leading-relaxed [&_h4]:font-bold [&_h1:first-child]:mt-0 [&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0 [&_p]:my-2 [&_p]:whitespace-pre-wrap [&_code]:rounded-sm [&_code]:border [&_code]:border-border-soft [&_code]:bg-panel-2 [&_code]:px-2 [&_code]:py-0.5 [&_code]:text-base [&_code]:leading-relaxed [&_pre.md-code]:my-2.5 [&_pre.md-code]:rounded-lg [&_pre.md-code]:border [&_pre.md-code]:border-border-soft [&_pre.md-code]:bg-panel-3 [&_pre.md-code]:px-3.5 [&_pre.md-code]:py-3 [&_pre.md-code]:font-mono [&_pre.md-code]:text-base [&_pre.md-code]:leading-normal [&_pre.md-code]:text-dim [&_pre.md-code]:whitespace-pre [&_pre.md-code]:overflow-x-auto [&_pre.md-code_code]:border-0 [&_pre.md-code_code]:bg-transparent [&_pre.md-code_code]:p-0 [&_pre.md-code_code]:leading-normal [&_ul]:my-2 [&_ul]:pl-7 [&_ol]:my-2 [&_ol]:pl-7 [&_li]:my-1 [&_blockquote]:mx-0 [&_blockquote]:my-2.5 [&_blockquote]:border-l-3 [&_blockquote]:border-border [&_blockquote]:py-1 [&_blockquote]:pr-0 [&_blockquote]:pl-3.5 [&_blockquote]:text-dim [&_blockquote]:whitespace-pre-wrap [&_hr]:my-3.5 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-border',
  // The old compact rules wrapped already-resolved colours in rgb(), which
  // computed to transparent backgrounds and inherited text. Preserve that
  // appearance rather than changing colours during the styling migration.
  compact:
    'text-sm/normal text-text [&_h1]:mt-0 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:leading-normal [&_h1]:font-semibold [&_h1]:text-waiting [&_h2]:mt-3.5 [&_h2]:mb-1.5 [&_h2]:text-sm [&_h2]:leading-normal [&_h2]:font-semibold [&_h3]:mt-3.5 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:leading-normal [&_h3]:font-semibold [&_h4]:mt-3.5 [&_h4]:mb-1.5 [&_h4]:text-sm [&_h4]:leading-normal [&_h4]:font-semibold [&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0 [&_p]:mt-0 [&_p]:mb-2 [&_p]:whitespace-pre-wrap [&_ul]:mt-0 [&_ul]:mb-2 [&_ul]:pl-5 [&_ol]:mt-0 [&_ol]:mb-2 [&_ol]:pl-5 [&_li]:mb-1 [&_code]:rounded-sm [&_code]:bg-transparent [&_code]:px-1 [&_code]:py-0 [&_code]:font-mono [&_code]:text-xs [&_code]:leading-normal [&_pre]:mt-0 [&_pre]:mb-2.5 [&_pre]:rounded-sm [&_pre]:border [&_pre]:border-border-soft [&_pre]:bg-transparent [&_pre]:px-2.5 [&_pre]:py-2 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-normal [&_pre]:text-dim [&_pre]:whitespace-pre-wrap [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:mx-0 [&_blockquote]:mt-0 [&_blockquote]:mb-2 [&_blockquote]:border-l-0 [&_blockquote]:pl-3 [&_blockquote]:text-inherit',
}

export const Prose = ({
  html,
  variant = 'default',
}: Readonly<{ html: string; variant?: TProseVariant }>) => (
  <div
    className={`${SHARED} ${VARIANT[variant]}`}
    // biome-ignore lint/security/noDangerouslySetInnerHtml: callers pass renderMarkdown output, which escapes its input
    dangerouslySetInnerHTML={{ __html: html }}
  />
)
