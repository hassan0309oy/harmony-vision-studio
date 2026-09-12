import { ExternalLink } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ChartData = {
  title: string;
  type: "line" | "bar" | "area" | "pie";
  series: string[];
  points: Array<Record<string, string | number>>;
  pageUrl?: string | null;
};

const COLORS = ["hsl(var(--primary))", "#f59e0b", "#22d3ee", "#a78bfa", "#f472b6", "#34d399"];

/** Graphique interactif réel affiché directement dans le chat. */
export function ChartResult({ data }: { data: ChartData }) {
  const { type, series, points } = data;
  const axis = { stroke: "hsl(var(--muted-foreground))", fontSize: 11 } as const;

  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-card">
      <figcaption className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
        <span className="truncate font-medium">{data.title}</span>
        {data.pageUrl && (
          <a
            href={data.pageUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
          >
            <ExternalLink className="size-3" /> Page web
          </a>
        )}
      </figcaption>
      <div className="h-64 w-full p-3">
        <ResponsiveContainer width="100%" height="100%">
          {type === "pie" ? (
            <PieChart>
              <Tooltip />
              <Pie data={points} dataKey={series[0] ?? "value"} nameKey="label" outerRadius={90} label>
                {points.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : type === "bar" ? (
            <BarChart data={points}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" {...axis} />
              <YAxis {...axis} />
              <Tooltip />
              <Legend />
              {series.map((s, i) => (
                <Bar key={s} dataKey={s} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          ) : type === "area" ? (
            <AreaChart data={points}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" {...axis} />
              <YAxis {...axis} />
              <Tooltip />
              <Legend />
              {series.map((s, i) => (
                <Area
                  key={s}
                  dataKey={s}
                  stroke={COLORS[i % COLORS.length]}
                  fill={COLORS[i % COLORS.length]}
                  fillOpacity={0.25}
                />
              ))}
            </AreaChart>
          ) : (
            <LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" {...axis} />
              <YAxis {...axis} />
              <Tooltip />
              <Legend />
              {series.map((s, i) => (
                <Line key={s} dataKey={s} stroke={COLORS[i % COLORS.length]} dot={false} strokeWidth={2} />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
