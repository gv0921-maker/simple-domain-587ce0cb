import { cn } from '@/lib/utils';

interface BarData {
  value: number;
  color: 'coral' | 'orange' | 'teal' | 'blue' | 'purple';
}

interface SimpleBarChartProps {
  data: BarData[];
  maxValue?: number;
  height?: number;
}

const colorMap = {
  coral: 'bg-chart-coral',
  orange: 'bg-chart-orange',
  teal: 'bg-chart-teal',
  blue: 'bg-chart-blue',
  purple: 'bg-chart-purple',
};

export function SimpleBarChart({ data, maxValue, height = 120 }: SimpleBarChartProps) {
  const max = maxValue || Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="flex items-end gap-2 justify-center" style={{ height }}>
      {data.map((bar, index) => {
        const barHeight = (bar.value / max) * 100;
        return (
          <div
            key={index}
            className={cn(
              'w-8 rounded-t transition-all duration-300 ease-out hover:opacity-80',
              colorMap[bar.color]
            )}
            style={{
              height: `${barHeight}%`,
              minHeight: bar.value > 0 ? 8 : 0,
              animationDelay: `${index * 100}ms`,
            }}
          />
        );
      })}
    </div>
  );
}
