import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/modules/core/ui/primitives/card';
import { Button } from '@/modules/core/ui/primitives/button';
import { ArrowLeft, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/modules/core/ui/primitives/chart';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, BarChart, Bar } from 'recharts';

// Mock data for charts
const chartData = {
  'shift-fill-rate': [
    { month: 'Jan', rate: 89 },
    { month: 'Feb', rate: 91 },
    { month: 'Mar', rate: 88 },
    { month: 'Apr', rate: 92 },
    { month: 'May', rate: 90 },
    { month: 'Jun', rate: 92 },
  ],
  'employee-utilization': [
    { month: 'Jan', utilization: 75 },
    { month: 'Feb', utilization: 78 },
    { month: 'Mar', utilization: 76 },
    { month: 'Apr', utilization: 80 },
    { month: 'May', utilization: 78 },
    { month: 'Jun', utilization: 78 },
  ],
  'overtime-analysis': [
    { week: 'Week 1', events: 2, cost: 320 },
    { week: 'Week 2', events: 1, cost: 180 },
    { week: 'Week 3', events: 3, cost: 430 },
    { week: 'Week 4', events: 2, cost: 290 },
  ],
};

// Type definition for analysis data structure
interface AnalysisDataItem {
  title: string;
  summary: string;
  details: string;
  recommendations: string[];
  metrics: Record<string, any>;
  chartType?: 'line' | 'bar';
}

// Comprehensive analysis data for all metrics
const analysisData: { [key: string]: AnalysisDataItem } = {
  // Workforce Utilization & Productivity
  'shift-fill-rate': {
    title: 'Shift Fill Rate Analysis',
    summary: '92% of planned shifts were filled over the last 30 days.',
    details: 'The shift fill rate is a key indicator of scheduling effectiveness and staff availability. A high rate suggests that the workforce is sufficient and rostering is well-aligned with demand. The current rate of 92% is healthy, though slightly below the target of 95%. Analysis shows that weekend shifts and early morning slots have lower fill rates.',
    recommendations: [
      'Analyze unfilled shifts to identify patterns (e.g., specific roles, times, or locations).',
      'Review staff availability and preferences to improve schedule alignment.',
      'Consider increasing the pool of casual or on-call staff for hard-to-fill shifts.',
      'Implement shift incentives for difficult-to-fill time slots.',
    ],
    metrics: { current: '92%', target: '95%', trend: 'up' },
    chartType: 'line',
  },
  'employee-utilization': {
    title: 'Employee Utilization Analysis',
    summary: 'Average employee utilization is at 78% for the current month.',
    details: 'This metric compares rostered hours to available hours. A rate of 78% indicates there is some capacity within the workforce. Drilling down can reveal which employees or departments have lower utilization, presenting opportunities for cross-training or re-assigning duties. Optimal utilization typically ranges between 75-85%.',
    recommendations: [
      'Identify staff with consistently low utilization for potential training opportunities.',
      'Cross-reference with skill-gap analysis to better deploy underutilized staff.',
      'Consider flexible scheduling options to increase utilization.',
      'Review staffing levels in departments with low utilization.',
    ],
    metrics: { current: '78%', target: '80%', trend: 'stable' },
    chartType: 'line',
  },
  'no-show-rate': {
    title: 'No-Show Rate Analysis',
    summary: 'Current no-show rate is 2.8%, within acceptable limits.',
    details: 'No-show rates track reliability and can indicate staff satisfaction or scheduling issues. A rate of 2.8% is within industry standards (2-5%), but monitoring trends is crucial. Patterns may emerge around specific days, times, or departments that require attention.',
    recommendations: [
      'Implement reminder systems for upcoming shifts.',
      'Analyze no-show patterns by day, time, and department.',
      'Consider attendance incentive programs.',
      'Review workload and scheduling preferences.',
    ],
    metrics: { current: '2.8%', target: '<3%', trend: 'down' },
  },
  'punctuality': {
    title: 'Punctuality Analysis',
    summary: '5 late starts and 2 early finishes recorded last week.',
    details: 'Punctuality tracking helps identify potential issues with scheduling, transportation, or staff engagement. The current metrics show occasional tardiness which is manageable but should be monitored for trends.',
    recommendations: [
      'Analyze patterns in late arrivals and early departures.',
      'Review transportation options for staff.',
      'Consider flexible start times where operationally feasible.',
      'Implement punctuality recognition programs.',
    ],
    metrics: { lateStarts: 5, earlyFinish: 2, trend: 'stable' },
  },
  'underutilized-staff': {
    title: 'Underutilized Staff Analysis',
    summary: 'Jamie Smith and Taylor Brown identified as underutilized.',
    details: 'Underutilized staff represent untapped potential and may indicate scheduling inefficiencies or skills mismatches. These staff members could benefit from additional training or role adjustments.',
    recommendations: [
      'Meet with underutilized staff to understand availability constraints.',
      'Assess skills and training needs for role expansion.',
      'Consider cross-training opportunities.',
      'Review department staffing distribution.',
    ],
    metrics: { count: 2, departments: ['Security', 'Guest Services'], trend: 'stable' },
  },

  // Event-Level Metrics
  'shift-demand-supply': {
    title: 'Shift Demand vs Supply Analysis',
    summary: 'Current demand of 48 shifts is well-covered by supply of 51.',
    details: 'The demand-supply ratio shows healthy coverage with a small buffer. This 6% oversupply provides flexibility for last-minute changes while avoiding overstaffing costs.',
    recommendations: [
      'Maintain current staffing levels for optimal coverage.',
      'Monitor demand patterns for seasonal adjustments.',
      'Consider flexible contracts for peak periods.',
    ],
    metrics: { demand: 48, supply: 51, ratio: '106%', trend: 'stable' },
  },
  'role-coverage': {
    title: 'Role Coverage Analysis',
    summary: '100% of critical roles are currently covered.',
    details: 'Full role coverage ensures operational continuity. This metric tracks whether all essential positions have assigned staff for each shift period.',
    recommendations: [
      'Maintain backup coverage for critical roles.',
      'Cross-train staff in multiple roles.',
      'Develop succession planning for key positions.',
    ],
    metrics: { coverage: '100%', criticalRoles: 12, trend: 'stable' },
  },
  'conflict-analysis': {
    title: 'Event Conflict Analysis',
    summary: '1 scheduling conflict identified and resolved.',
    details: 'Scheduling conflicts can disrupt operations and staff satisfaction. Quick identification and resolution minimize impact on service delivery.',
    recommendations: [
      'Implement automated conflict detection.',
      'Establish clear conflict resolution procedures.',
      'Maintain communication channels for rapid response.',
    ],
    metrics: { conflicts: 1, resolved: 1, pending: 0, trend: 'down' },
  },

  // Time & Attendance Tracking
  'actual-vs-scheduled-hours': {
    title: 'Actual vs Scheduled Hours Analysis',
    summary: 'Actual hours (316h) vs scheduled hours (322h) showing -1.9% variance.',
    details: 'The slight underrun in actual hours compared to scheduled hours may indicate early departures, no-shows, or efficient task completion. This 6-hour difference represents good alignment between planning and execution.',
    recommendations: [
      'Investigate reasons for hour variances.',
      'Adjust future scheduling based on actual patterns.',
      'Consider workload optimization opportunities.',
    ],
    metrics: { actual: '316h', scheduled: '322h', variance: '-1.9%', trend: 'stable' },
  },
  'clock-discrepancies': {
    title: 'Clock Discrepancies Analysis',
    summary: '4% of clock-in/out times show discrepancies.',
    details: 'Clock discrepancies can indicate system issues, training needs, or deliberate time manipulation. A 4% rate requires monitoring and potential process improvements.',
    recommendations: [
      'Review time tracking system functionality.',
      'Provide additional training on proper clock procedures.',
      'Implement supervisor validation for discrepancies.',
      'Consider biometric time tracking systems.',
    ],
    metrics: { discrepancy: '4%', target: '<2%', trend: 'up' },
  },
  'overtime-analysis': {
    title: 'Overtime Analysis',
    summary: '3 overtime events recorded with $430 total cost.',
    details: 'Overtime costs are within budget but should be monitored for trends. Events typically occur due to extended operations, staff shortages, or emergency situations.',
    recommendations: [
      'Analyze root causes of overtime events.',
      'Implement better shift handover procedures.',
      'Consider on-call staffing for predictable extensions.',
      'Monitor overtime patterns by department and role.',
    ],
    metrics: { events: 3, cost: '$430', avgCost: '$143', trend: 'down' },
    chartType: 'bar',
  },

  // Scheduling Efficiency
  'roster-approval-time': {
    title: 'Roster Approval Time Analysis',
    summary: 'Average approval time is 36 hours from draft to publication.',
    details: 'The current approval process takes 1.5 days on average, which allows for proper review but may delay staff notification. Streamlining approval workflows could improve staff satisfaction.',
    recommendations: [
      'Implement automated approval workflows.',
      'Set clear approval deadlines.',
      'Provide template-based roster creation.',
      'Enable digital approval processes.',
    ],
    metrics: { current: '36h', target: '24h', trend: 'stable' },
  },
  'shift-edit-frequency': {
    title: 'Shift Edit Frequency Analysis',
    summary: '14 edits made to published rosters this week.',
    details: 'Post-publication edits indicate planning accuracy issues or changing operational needs. While some flexibility is necessary, frequent edits can disrupt staff planning.',
    recommendations: [
      'Improve initial roster planning accuracy.',
      'Implement change approval processes.',
      'Analyze edit patterns to identify root causes.',
      'Provide buffer time in initial scheduling.',
    ],
    metrics: { edits: 14, target: '<10', trend: 'up' },
  },
  'roster-stability': {
    title: 'Roster Stability Index Analysis',
    summary: '91% stability index shows good week-to-week consistency.',
    details: 'High roster stability indicates predictable scheduling patterns, which improves staff satisfaction and operational efficiency. The 91% index is strong but has room for improvement.',
    recommendations: [
      'Maintain consistent scheduling patterns.',
      'Plan for seasonal variations in advance.',
      'Implement change management procedures.',
      'Monitor stability by department and role.',
    ],
    metrics: { stability: '91%', target: '95%', trend: 'stable' },
  },

  // Location-based Insights
  'venue-heatmaps': {
    title: 'Venue Staffing Heatmaps Analysis',
    summary: 'Main Hall shows 12% overtime usage, indicating high demand.',
    details: 'Venue heatmaps reveal staffing pressure points across different locations. Main Hall consistently requires additional staffing, suggesting either high activity levels or inadequate base staffing.',
    recommendations: [
      'Increase base staffing for high-demand venues.',
      'Analyze activity patterns by venue.',
      'Consider venue-specific scheduling strategies.',
      'Implement predictive staffing models.',
    ],
    metrics: { topVenue: 'Main Hall', overtimeRate: '12%', trend: 'up' },
  },
  'travel-time-tracking': {
    title: 'Travel Time Tracking Analysis',
    summary: 'Average travel time is 22 minutes with 2 staff flagged for late arrivals.',
    details: 'Travel time tracking helps optimize scheduling and identify potential transportation issues. The current metrics show generally good punctuality with isolated concerns.',
    recommendations: [
      'Provide transportation assistance for flagged staff.',
      'Adjust start times based on travel patterns.',
      'Consider carpooling or shuttle services.',
      'Monitor traffic and route conditions.',
    ],
    metrics: { avgTime: '22min', flagged: 2, target: '<3', trend: 'stable' },
  },

  // Financial & Budget Tracking
  'labor-cost-per-event': {
    title: 'Labor Cost per Event Analysis',
    summary: 'Average labor cost per event is $4,550.',
    details: 'Labor costs represent the largest operational expense. Current costs are within budget but monitoring trends is essential for financial planning and pricing strategies.',
    recommendations: [
      'Track cost trends by event type and size.',
      'Optimize staffing models for cost efficiency.',
      'Implement cost benchmarking against industry standards.',
      'Develop cost forecasting models.',
    ],
    metrics: { avgCost: '$4,550', budget: '$5,000', variance: '-9%', trend: 'stable' },
  },
  'cost-per-role': {
    title: 'Cost per Role Analysis',
    summary: 'Supervisors cost $2,200 on average, highest among all roles.',
    details: 'Role-based cost analysis reveals resource allocation patterns. Supervisor costs reflect premium rates and overtime frequency for management positions.',
    recommendations: [
      'Review supervisor workload and scheduling.',
      'Consider assistant supervisor roles for cost optimization.',
      'Analyze cost-effectiveness of different role structures.',
      'Implement role-based budgeting.',
    ],
    metrics: { highestRole: 'Supervisors', cost: '$2,200', avgRole: '$1,650', trend: 'up' },
  },
  'budget-variance': {
    title: 'Budget Variance Analysis',
    summary: 'Current underspend of $480 against budget.',
    details: 'Budget underspend indicates efficient cost management but may also suggest understaffing. Regular variance analysis ensures optimal resource allocation.',
    recommendations: [
      'Analyze causes of budget variance.',
      'Ensure service quality is not compromised.',
      'Consider reinvestment in staff development.',
      'Adjust future budget forecasts based on trends.',
    ],
    metrics: { variance: '-$480', percentage: '-2.1%', trend: 'stable' },
  },
  'high-cost-staff': {
    title: 'High Cost Staff Analysis',
    summary: 'Jane Smith worked 5 high-premium assignments this month.',
    details: 'Identifying high-cost staff patterns helps optimize assignments and manage premium pay exposure. Frequent high-cost assignments may indicate skill specialization or scheduling inefficiencies.',
    recommendations: [
      'Cross-train staff to reduce dependency on high-cost personnel.',
      'Analyze assignment patterns for optimization opportunities.',
      'Review premium pay policies and triggers.',
      'Balance workload across qualified staff.',
    ],
    metrics: { topStaff: 'Jane Smith', assignments: 5, premiumRate: '45%', trend: 'up' },
  },

  // Forecasting & Planning
  'demand-forecasting': {
    title: 'Demand Forecasting Analysis',
    summary: 'Forecasting shows 49 additional shifts needed next month.',
    details: 'Demand forecasting uses historical data and trend analysis to predict future staffing needs. The projected increase aligns with seasonal patterns and scheduled events.',
    recommendations: [
      'Begin recruiting for anticipated demand increase.',
      'Review contractor and casual staff availability.',
      'Adjust training schedules to prepare for increased demand.',
      'Update budget forecasts for additional staffing costs.',
    ],
    metrics: { nextMonth: '+49 shifts', increase: '18%', confidence: '87%', trend: 'up' },
  },
  'historical-trends': {
    title: 'Historical Shift Trends Analysis',
    summary: 'Wednesdays show 12% higher demand than average.',
    details: 'Historical trend analysis reveals patterns in staffing demand across different time periods. Wednesday peaks may correlate with specific events or operational activities.',
    recommendations: [
      'Adjust base staffing for high-demand days.',
      'Analyze root causes of Wednesday demand spikes.',
      'Implement dynamic scheduling based on historical patterns.',
      'Plan special events around demand cycles.',
    ],
    metrics: { peakDay: 'Wednesday', increase: '12%', pattern: 'Weekly', trend: 'stable' },
  },
  'ai-recommendations': {
    title: 'AI-based Recommendations Analysis',
    summary: 'AI suggests increasing AM Assist coverage on Thursdays.',
    details: 'Machine learning algorithms analyze patterns to provide staffing optimization suggestions. Current recommendation addresses observed service gaps in morning assistance coverage.',
    recommendations: [
      'Implement AI-suggested staffing adjustments.',
      'Monitor impact of AI recommendations on service quality.',
      'Provide feedback to improve AI accuracy.',
      'Integrate AI insights into planning processes.',
    ],
    metrics: { suggestions: 3, implemented: 2, accuracy: '89%', trend: 'up' },
  },

  // Employee Behavior Insights
  'top-performers': {
    title: 'Top Performers Analysis',
    summary: 'Alex Johnson and Sam Wilson identified as top performers.',
    details: 'Performance tracking based on attendance, reliability, and feedback scores. Top performers can serve as mentors and may be candidates for advancement opportunities.',
    recommendations: [
      'Recognize and reward top performers.',
      'Utilize top performers as mentors for new staff.',
      'Consider advancement opportunities.',
      'Analyze success factors for replication.',
    ],
    metrics: { count: 2, avgScore: '94%', retention: '100%', trend: 'stable' },
  },
  'shift-swaps': {
    title: 'Shift Swaps Analysis',
    summary: 'Friday 3-5pm AM Base shifts are most frequently swapped.',
    details: 'High swap rates for specific shifts may indicate scheduling conflicts, preference mismatches, or operational challenges. Understanding patterns helps improve initial scheduling.',
    recommendations: [
      'Investigate reasons for high swap rates.',
      'Consider alternative scheduling for problem slots.',
      'Implement preference-based scheduling systems.',
      'Provide incentives for less popular shifts.',
    ],
    metrics: { topSlot: 'Fri 3-5pm', swapRate: '23%', approved: '78%', trend: 'up' },
  },
  'fatigue-risk': {
    title: 'Fatigue Risk Analysis',
    summary: '2 staff members flagged for potential fatigue risk.',
    details: 'Fatigue monitoring protects staff wellbeing and maintains service quality. Current flags indicate excessive hours or insufficient rest periods requiring attention.',
    recommendations: [
      'Review workload for flagged staff members.',
      'Implement mandatory rest periods.',
      'Monitor shift lengths and frequencies.',
      'Provide fatigue management training.',
    ],
    metrics: { flagged: 2, avgHours: '52h/week', target: '<48h', trend: 'stable' },
  },

  // Communication & Interaction
  'swap-requests': {
    title: 'Swap Requests Analysis',
    summary: '9 swap requests this week with 78% approval rate.',
    details: 'Swap request patterns indicate staffing flexibility and satisfaction. High approval rates suggest good work-life balance support while maintaining operational coverage.',
    recommendations: [
      'Streamline swap request approval processes.',
      'Analyze denied requests for pattern identification.',
      'Implement automated swap matching systems.',
      'Provide clear swap policy guidelines.',
    ],
    metrics: { requests: 9, approved: 7, rate: '78%', avgTime: '4h', trend: 'stable' },
  },
  'broadcast-engagement': {
    title: 'Broadcast Engagement Analysis',
    summary: '35 views and 10 replies to recent broadcast messages.',
    details: 'Communication engagement metrics help assess information dissemination effectiveness. Current rates show good message reach with moderate interaction levels.',
    recommendations: [
      'Optimize message timing for higher engagement.',
      'Use interactive content to increase participation.',
      'Segment broadcasts for targeted messaging.',
      'Track engagement trends over time.',
    ],
    metrics: { views: 35, replies: 10, rate: '29%', trend: 'up' },
  },
  'staff-feedback': {
    title: 'Staff Feedback Analysis',
    summary: '4.2-star average rating from 12 survey responses.',
    details: 'Regular feedback collection provides insights into staff satisfaction and areas for improvement. Current ratings indicate generally positive sentiment with room for enhancement.',
    recommendations: [
      'Increase survey response rates.',
      'Address specific feedback themes.',
      'Implement feedback loop closure.',
      'Benchmark against industry standards.',
    ],
    metrics: { rating: '4.2★', responses: 12, target: '4.5★', trend: 'up' },
  },
};

const AnalysisPage: React.FC = () => {
  const { metricId } = useParams<{ metricId: string }>();

  if (!metricId) {
    return (
      <div className="flex items-center justify-center h-full text-white">
        Metric ID was not provided.
      </div>
    );
  }
  
  const data = analysisData[metricId] || {
    title: `Analysis for ${metricId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`,
    summary: 'Detailed analysis for this metric is not yet available.',
    details: 'Please check back later for a full breakdown, historical trends, and actionable insights related to this performance indicator.',
    recommendations: [],
    metrics: {},
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
    if (!data.chartType || !chartData[metricId as keyof typeof chartData]) return null;
    
    const config = {
      rate: { label: "Rate", color: "#3b82f6" },
      utilization: { label: "Utilization", color: "#10b981" },
      events: { label: "Events", color: "#f59e0b" },
      cost: { label: "Cost", color: "#ef4444" },
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
                <LineChart data={chartData[metricId as keyof typeof chartData]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="month" stroke="#9ca3af" />
                  <YAxis stroke="#9ca3af" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line 
                    type="monotone" 
                    dataKey={metricId === 'shift-fill-rate' ? 'rate' : 'utilization'} 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                  />
                </LineChart>
              ) : (
                <BarChart data={chartData[metricId as keyof typeof chartData]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="week" stroke="#9ca3af" />
                  <YAxis stroke="#9ca3af" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="events" fill="#f59e0b" />
                  <Bar dataKey="cost" fill="#ef4444" />
                </BarChart>
              )}
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-8 animate-fade-in pb-24 md:pb-0">
      <div>
        <Button asChild variant="ghost" className="text-white/80 hover:bg-white/10 hover:text-white pl-1">
          <Link to="/insights">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Insights Overview
          </Link>
        </Button>
      </div>

      <div className="glass-panel p-8 border border-white/10 rounded-2xl backdrop-blur-xl bg-white/5">
        <h1 className="text-3xl lg:text-4xl font-bold mb-4 bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">{data.title}</h1>
        <p className="text-lg text-white/70 mb-4">{data.summary}</p>
        
        {data.metrics && Object.keys(data.metrics).length > 0 && (
          <div className="flex flex-wrap gap-4 mt-4">
            {Object.entries(data.metrics).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2 px-3 py-2 bg-white/10 rounded-lg">
                <span className="text-white/60 text-sm capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                <span className="text-white font-medium">{value}</span>
                {key === 'trend' && getTrendIcon(value as string)}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-white/5 border-white/10 text-white">
            <CardHeader>
              <CardTitle className="text-white/90">Detailed Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-white/80 leading-relaxed">{data.details}</p>
            </CardContent>
          </Card>
          
          {renderChart()}
        </div>
        
        <div className="space-y-6">
          <Card className="bg-white/5 border-white/10 text-white">
            <CardHeader>
              <CardTitle className="text-white/90">Recommendations</CardTitle>
            </CardHeader>
            <CardContent>
              {data.recommendations.length > 0 ? (
                <ul className="list-disc list-inside space-y-3 text-white/80">
                  {data.recommendations.map((rec: string, index: number) => (
                    <li key={index} className="leading-relaxed">{rec}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-white/60">No specific recommendations at this time.</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white/5 border-white/10 text-white">
            <CardHeader>
              <CardTitle className="text-white/90">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="outline" className="w-full justify-start text-white border-white/20 hover:bg-white/10">
                Export Report
              </Button>
              <Button variant="outline" className="w-full justify-start text-white border-white/20 hover:bg-white/10">
                Schedule Review
              </Button>
              <Button variant="outline" className="w-full justify-start text-white border-white/20 hover:bg-white/10">
                Set Alert
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AnalysisPage;
