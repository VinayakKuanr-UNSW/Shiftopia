import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from '@/modules/core/ui/primitives/card';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { useMetricTrend } from "../../state/useMetricTrend";

const ChartsView: React.FC = () => {
    const filters = {
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
    };

    // In a real app, you might fetch specific trend data here.
    // For now, we'll keep the sample data structure but show how to use the hook.
    const { data: attendanceTrend } = useMetricTrend("SHIFT_FILL_RATE", filters);

    const staffAttendanceData = [
        { name: 'Mon', convention: 85, exhibition: 78, theatre: 90 },
        { name: 'Tue', convention: 88, exhibition: 82, theatre: 93 },
        { name: 'Wed', convention: 90, exhibition: 85, theatre: 88 },
        { name: 'Thu', convention: 92, exhibition: 80, theatre: 85 },
        { name: 'Fri', convention: 86, exhibition: 75, theatre: 92 },
        { name: 'Sat', convention: 78, exhibition: 72, theatre: 80 },
        { name: 'Sun', convention: 75, exhibition: 68, theatre: 75 },
    ];

    const departmentPerformanceData = [
        { name: 'Convention', value: 85, color: '#3b82f6' },
        { name: 'Exhibition', value: 78, color: '#22c55e' },
        { name: 'Theatre', value: 92, color: '#ef4444' },
    ];

    const shiftStatusData = [
        { name: 'Completed', value: 68 },
        { name: 'Cancelled', value: 8 },
        { name: 'Active', value: 15 },
        { name: 'No-Show', value: 4 },
        { name: 'Swapped', value: 5 },
    ];

    const COLORS = ['#22c55e', '#ef4444', '#3b82f6', '#eab308', '#a855f7'];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card className="bg-white/5 border border-white/10">
                <CardHeader>
                    <CardTitle className="text-lg">Staff Attendance</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="h-60">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={staffAttendanceData}>
                                <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1e1e2e', borderColor: '#444' }}
                                    labelStyle={{ color: '#fff' }}
                                />
                                <Line type="monotone" dataKey="convention" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                                <Line type="monotone" dataKey="exhibition" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                                <Line type="monotone" dataKey="theatre" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                                <Legend />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-white/5 border border-white/10">
                <CardHeader>
                    <CardTitle className="text-lg">Department Performance</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="h-60">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={departmentPerformanceData}>
                                <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1e1e2e', borderColor: '#444' }}
                                    labelStyle={{ color: '#fff' }}
                                />
                                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                    {departmentPerformanceData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-white/5 border border-white/10">
                <CardHeader>
                    <CardTitle className="text-lg">Shift Status</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="h-60">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={shiftStatusData}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={false}
                                    outerRadius={80}
                                    fill="#8884d8"
                                    dataKey="value"
                                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                >
                                    {shiftStatusData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1e1e2e', borderColor: '#444' }}
                                    labelStyle={{ color: '#fff' }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-white/5 border border-white/10 md:col-span-2 lg:col-span-3">
                <CardHeader>
                    <CardTitle className="text-lg">Weekly Overview</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={staffAttendanceData}>
                                <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#1e1e2e', borderColor: '#444' }}
                                    labelStyle={{ color: '#fff' }}
                                />
                                <Legend />
                                <Bar dataKey="convention" name="Convention" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="exhibition" name="Exhibition" fill="#22c55e" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="theatre" name="Theatre" fill="#ef4444" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default ChartsView;
