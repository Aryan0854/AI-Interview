"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  BarChart as ReBarChart,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  LineChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

const CHART_HEIGHT = 288;

function ChartFrame({ children }: { children: React.ReactElement }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const update = () => {
      const { width, height } = node.getBoundingClientRect();
      setSize({
        width: Math.max(0, Math.floor(width)),
        height: Math.max(CHART_HEIGHT, Math.floor(height)),
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="h-72 w-full min-h-[288px] min-w-0">
      {size.width > 0 && size.height > 0
        ? React.cloneElement(children, { width: size.width, height: size.height })
        : null}
    </div>
  );
}

type SizedChartProps = {
  width?: number;
  height?: number;
  data: any[];
};

export function DashboardRadarChart({ data, width = 0, height = CHART_HEIGHT }: SizedChartProps) {
  if (width <= 0 || height <= 0) return null;

  return (
    <ResponsiveContainer width={width} height={height} minWidth={0}>
      <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
        <PolarGrid stroke="#e2e8f0" strokeDasharray="3 3" />
        <PolarAngleAxis dataKey="subject" tick={{ fill: "#64748b", fontSize: 10, fontWeight: 500 }} />
        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
        <Radar name="Proficiency" dataKey="value" stroke="#8b5cf6" strokeWidth={2} fill="#8b5cf6" fillOpacity={0.2} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export function DashboardTrendChart({ data, width = 0, height = CHART_HEIGHT }: SizedChartProps) {
  if (width <= 0 || height <= 0) return null;

  const showAxis = data.length <= 3;

  return (
    <ResponsiveContainer width={width} height={height} minWidth={0}>
      <LineChart data={data} margin={{ top: 16, right: 20, left: 8, bottom: showAxis ? 8 : 0 }}>
        <XAxis
          dataKey="date"
          hide={!showAxis}
          tick={{ fill: "#64748b", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis hide domain={[0, 100]} />
        <Tooltip
          contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)", fontSize: "12px", fontWeight: 600, padding: "8px 12px" }}
          labelStyle={{ display: "none" }}
          itemStyle={{ color: "#4f46e5" }}
          cursor={{ stroke: "#e0e7ff", strokeWidth: 2, strokeDasharray: "4 4" }}
        />
        <Line
          type="monotone"
          dataKey="score"
          stroke="#4f46e5"
          strokeWidth={3}
          dot={{ r: 5, strokeWidth: 2, fill: "#fff" }}
          activeDot={{ r: 6, fill: "#4f46e5", stroke: "#fff" }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DashboardWeeklyChart({ data, width = 0, height = CHART_HEIGHT }: SizedChartProps) {
  if (width <= 0 || height <= 0) return null;

  return (
    <ResponsiveContainer width={width} height={height} minWidth={0}>
      <ReBarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: "#f8fafc" }}
          contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)", fontSize: "12px" }}
        />
        <Bar dataKey="tests" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={24} name="Tests taken" />
      </ReBarChart>
    </ResponsiveContainer>
  );
}

export function DashboardRadarChartFrame({ data }: { data: any[] }) {
  return (
    <ChartFrame>
      <DashboardRadarChart data={data} />
    </ChartFrame>
  );
}

export function DashboardTrendChartFrame({ data }: { data: any[] }) {
  return (
    <ChartFrame>
      <DashboardTrendChart data={data} />
    </ChartFrame>
  );
}

export function DashboardWeeklyChartFrame({ data }: { data: any[] }) {
  return (
    <ChartFrame>
      <DashboardWeeklyChart data={data} />
    </ChartFrame>
  );
}
