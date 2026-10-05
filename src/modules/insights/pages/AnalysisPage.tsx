import React, { useMemo } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/modules/core/ui/primitives/card';
import { Button } from '@/modules/core/ui/primitives/button';
import { ArrowLeft, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/modules/core/ui/primitives/chart';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { useMetricAnalysis } from '../hooks/useMetricAnalysis';
import { recentQuarters } from '../hooks/useKpiFilters';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageState } from '@/modules/core/ui/components/PageState';
import { LineChart as LineChartIcon } from 'lucide-react';
import { format } from 'date-fns';

const AnalysisPage: React.FC = () => {
  const { metricId } = useParams<{ metricId: string }>();
  const { scope } = useScopeFilter('managerial');
  const [searchParams] = useSearchParams();

  // The period travels in the URL from the tile that opened this page. Without
  // it the drill-down defaulted to THIS_MONTH off the DEVICE clock, so a tile
  // clicked while viewing Q1 2026 opened an analysis of the current month —
  // and a manager overseas saw a different month again. Quarter boundaries are
  // Sydney-anchored, matching the rest of the KPI surface.
  const quarters = useMemo(() => recentQuarters(5), []);
  const period = useMemo(() => {
    const label = searchParams.get('period');
    return quarters.find((q) => q.label === label) ?? quarters[0];
  }, [searchParams, quarters]);

  const filters = useMemo(() => ({
    startDate: period.startDate,
    endDate: period.endDate,
    orgIds: scope.org_ids.length ? scope.org_ids : undefined,
    deptIds: scope.dept_ids.length ? scope.dept_ids : undefined,
  }), [period, scope]);

  const { data: liveData, isLoading } = useMetricAnalysis(metricId, filters);

  if (!metricId) {
    return (
      <div className="flex items-center justify-center h-full text-white">
        Metric ID was not provided.
      </div>
    );
  }

  if (isLoading) {
    return (
      <PageState
        state="loading"
        scope="section"
        title="Analyzing live data"
        description="Preparing this metric’s analysis."
      />
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = (liveData as any) || {
    title: `Analysis for ${metricId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`,
    summary: 'Detailed analysis for this metric is not yet available.',
    details: 'Please check back later for a full breakdown, historical trends, and actionable insights related to this performance indicator.',
    recommendations: [],
    metrics: {},
    chartData: [],
    chartType: 'line'
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up':
        return <TrendingUp className="h-4 w-4 text-green-400" />;
      case 'down':
        return <TrendingDown className="h-4 w-4 text-red-400" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
    }
  };

  const renderChart = () => {
    if (!data.chartData || data.chartData.length === 0) {
      return (
        <Card className="bg-white/5 border-white/10 text-white">
          <CardHeader>
            <CardTitle className="text-white/90">Trend Analysis</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px] flex items-center justify-center text-white/40 italic">
            Insufficient data points for trend visualization in this period.
          </CardContent>
        </Card>
      );
    }
    
    const config = {
      value: { label: "Value", color: "#3b82f6" },
    };

    return (
      <Card className="bg-white/5 border-white/10 text-white">
        <CardHeader>
          <CardTitle className="text-white/90">Trend Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              {data.chartType === 'line' ? (
                <LineChart data={data.chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                  <XAxis 
                    dataKey="label" 
                    stroke="#9ca3af" 
                    fontSize={10}
                    tickFormatter={(val) => format(new Date(val), 'MMM dd')}
                  />
                  <YAxis stroke="#9ca3af" fontSize={10} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line 
                    type="monotone" 
                    dataKey="value" 
                    stroke="#3b82f6" 
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }}
                    activeDot={{ r: 6, strokeWidth: 0 }}
                  />
                </LineChart>
              ) : (
                <BarChart data={data.chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                  <XAxis 
                    dataKey="label" 
                    stroke="#9ca3af" 
                    fontSize={10}
                    tickFormatter={(val) => format(new Date(val), 'MMM dd')}
                  />
                  <YAxis stroke="#9ca3af" fontSize={10} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <GoldStandardHeader
        title={`${data.title} · ${period.label}`}
        Icon={LineChartIcon}
        rightActions={
          <Button asChild variant="ghost" size="sm" className="text-foreground/80 hover:bg-muted">
            {/* Carry the period back so returning does not silently reset it. */}
            <Link to={`/insights?period=${encodeURIComponent(period.label)}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to KPI
            </Link>
          </Button>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-4 lg:px-6 pb-24 md:pb-6 space-y-4 animate-fade-in">
      <div className="glass-panel p-4 lg:p-6 border border-white/10 rounded-2xl backdrop-blur-xl bg-white/5 shadow-2xl shadow-black/20">
        <p className="text-lg text-white/70 mb-6 font-medium">{data.summary}</p>

        {data.metrics && Object.keys(data.metrics).length > 0 && (
          <div className="flex flex-wrap gap-3">
            {Object.entries(data.metrics).map(([key, value]) => (
              <div key={key} className="flex items-center gap-3 px-4 py-3 bg-white/5 border border-white/5 rounded-xl backdrop-blur-md">
                <div className="flex flex-col">
                    <span className="text-muted-foreground text-[11px] uppercase font-bold tracking-widest">{key}</span>
                    <div className="flex items-center gap-2">
                        <span className="text-white font-bold text-lg leading-none">{value as string}</span>
                        {key === 'trend' && getTrendIcon(value as string)}
                    </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card className="bg-white/5 border-white/10 text-white overflow-hidden rounded-2xl shadow-xl">
            <CardHeader className="bg-white/5 border-b border-white/5">
              <CardTitle className="text-white/90 text-sm font-bold uppercase tracking-wider">Detailed Context</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <p className="text-white/70 leading-relaxed text-base font-light">{data.details}</p>
            </CardContent>
          </Card>
          
          {renderChart()}
        </div>
        
        <div className="space-y-4">
          <Card className="bg-white/5 border-white/10 text-white rounded-2xl shadow-xl overflow-hidden">
            <CardHeader className="bg-white/5 border-b border-white/5">
              <CardTitle className="text-white/90 text-sm font-bold uppercase tracking-wider">Recommendations</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {data.recommendations && data.recommendations.length > 0 ? (
                <ul className="space-y-4">
                  {data.recommendations.map((rec: string, index: number) => (
                    <li key={index} className="flex gap-3 text-white/70 group">
                        <div className="h-6 w-6 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 text-blue-400 font-bold text-xs">
                            {index + 1}
                        </div>
                        <span className="text-sm font-medium leading-tight group-hover:text-white transition-colors">{rec}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-white/40 italic text-sm">No specific recommendations at this time.</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white/5 border-white/10 text-white rounded-2xl shadow-xl overflow-hidden">
            <CardHeader className="bg-white/5 border-b border-white/5">
              <CardTitle className="text-white/90 text-sm font-bold uppercase tracking-wider">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-4 px-4 pb-4">
              <Button variant="outline" className="w-full justify-start text-white border-white/10 hover:bg-white/10 h-11 rounded-xl">
                Export Detailed PDF
              </Button>
              <Button variant="outline" className="w-full justify-start text-white border-white/10 hover:bg-white/10 h-11 rounded-xl">
                Set Performance Alert
              </Button>
              <Button variant="outline" className="w-full justify-start text-white border-white/10 hover:bg-white/10 h-11 rounded-xl">
                Share with Department Head
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
      </div>
    </div>
  );
};

export default AnalysisPage;
