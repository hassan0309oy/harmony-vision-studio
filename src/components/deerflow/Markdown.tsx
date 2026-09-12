import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-deerflow space-y-3 text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2"
            />
          ),
          ul: (props) => <ul {...props} className="ml-5 list-disc space-y-1" />,
          ol: (props) => <ol {...props} className="ml-5 list-decimal space-y-1" />,
          h1: (props) => <h1 {...props} className="text-lg font-semibold" />,
          h2: (props) => <h2 {...props} className="text-base font-semibold" />,
          h3: (props) => <h3 {...props} className="text-sm font-semibold" />,
          code: (props) => (
            <code
              {...props}
              className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8em] text-foreground"
            />
          ),
          pre: (props) => (
            <pre
              {...props}
              className="overflow-x-auto rounded-lg border border-border bg-muted p-3 text-xs"
            />
          ),
          table: (props) => (
            <table {...props} className="w-full border-collapse text-xs [&_td]:border [&_td]:border-border [&_td]:p-1.5 [&_th]:border [&_th]:border-border [&_th]:p-1.5" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
