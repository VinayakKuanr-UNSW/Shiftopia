
import React, { useState } from 'react';
import { useAuth } from '@/platform/auth/useAuth';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/modules/core/ui/primitives/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/modules/core/ui/primitives/tabs';
import { Button } from '@/modules/core/ui/primitives/button';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/modules/core/ui/primitives/select';
import { useToast } from '@/modules/core/ui/primitives/use-toast';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/modules/core/ui/primitives/table';
import { employeeService } from '@/modules/users/api/employee.service';
import { Role, RemunerationLevel } from '@/types';
import { AlertCircle, Database, Settings, Users, Plus, Search, Shield, Download, Upload, Trash2, Save, Activity, HardDrive } from 'lucide-react';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { motion } from 'framer-motion';

const ConfigurationsPage: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("employees");
  const [newEmployee, setNewEmployee] = useState({
    firstName: '',
    lastName: '',
    email: '',
    department: '',
    role: 'Staff' as Role,
    remunerationLevel: '1' as RemunerationLevel
  });

  // Fetch employees data
  const { data: employees, isLoading: loadingEmployees } = useQuery({
    queryKey: ['employees'],
    queryFn: employeeService.getAllEmployees,
  });

  const handleAddEmployee = () => {
    toast({
      title: "Employee Added",
      description: `${newEmployee.firstName} ${newEmployee.lastName} has been added successfully.`,
    });
    // Reset form
    setNewEmployee({
      firstName: '',
      lastName: '',
      email: '',
      department: '',
      role: 'Staff' as Role,
      remunerationLevel: '1' as RemunerationLevel
    });
  };

  const handleSystemSettingSave = (setting: string) => {
    toast({
      title: "Setting Updated",
      description: `${setting} has been updated successfully.`,
    });
  };

  const handleRestoreDatabase = () => {
    toast({
      title: "Database Restored",
      description: "The database has been restored to the default state.",
      variant: "destructive"
    });
  };

  return (
    <div className="w-full min-h-screen p-4 md:p-8 space-y-8 bg-transparent">
      {/* Header Section */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4"
      >
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">System Configurations</h1>
          <p className="text-blue-200/60 mt-1 max-w-2xl">
            Manage system settings, database operations, and employee data
          </p>
        </div>

        {user?.role === 'admin' && (
          <Badge variant="glass" className="bg-purple-500/10 text-purple-300 border-purple-500/20 px-3 py-1.5 flex items-center gap-2">
            <Shield className="h-3.5 w-3.5" />
            Admin Access Granted
          </Badge>
        )}
      </motion.div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-8">
        <TabsList className="bg-[#1a2744]/30 backdrop-blur-xl border border-white/5 p-1 h-auto rounded-xl inline-flex">
          <TabsTrigger value="employees" className="data-[state=active]:bg-primary data-[state=active]:text-white px-4 py-2 rounded-lg gap-2 text-blue-200/60 transition-all">
            <Users className="h-4 w-4" />
            Employees
          </TabsTrigger>
          <TabsTrigger value="database" className="data-[state=active]:bg-primary data-[state=active]:text-white px-4 py-2 rounded-lg gap-2 text-blue-200/60 transition-all">
            <Database className="h-4 w-4" />
            Database
          </TabsTrigger>
          <TabsTrigger value="system" className="data-[state=active]:bg-primary data-[state=active]:text-white px-4 py-2 rounded-lg gap-2 text-blue-200/60 transition-all">
            <Settings className="h-4 w-4" />
            System Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="outline-none">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Add Employee Form */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="col-span-1"
            >
              <Card className="border border-white/5 bg-[#1a2744]/30 backdrop-blur-xl shadow-xl h-full">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary">
                      <Plus className="h-5 w-5" />
                    </div>
                    Add New Employee
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form className="space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="firstName" className="text-blue-200/60">First Name</Label>
                        <Input
                          id="firstName"
                          value={newEmployee.firstName}
                          onChange={(e) => setNewEmployee({ ...newEmployee, firstName: e.target.value })}
                          className="bg-black/20 border-white/10 text-white focus:border-primary/50"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastName" className="text-blue-200/60">Last Name</Label>
                        <Input
                          id="lastName"
                          value={newEmployee.lastName}
                          onChange={(e) => setNewEmployee({ ...newEmployee, lastName: e.target.value })}
                          className="bg-black/20 border-white/10 text-white focus:border-primary/50"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-blue-200/60">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={newEmployee.email}
                        onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })}
                        className="bg-black/20 border-white/10 text-white focus:border-primary/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="department" className="text-blue-200/60">Department</Label>
                      <Select
                        value={newEmployee.department}
                        onValueChange={(value) => setNewEmployee({ ...newEmployee, department: value })}
                      >
                        <SelectTrigger className="bg-black/20 border-white/10 text-white focus:border-primary/50">
                          <SelectValue placeholder="Select department" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#1a2744] border-white/10 text-white backdrop-blur-xl">
                          <SelectItem value="convention">Convention Centre</SelectItem>
                          <SelectItem value="exhibition">Exhibition Centre</SelectItem>
                          <SelectItem value="theatre">Theatre</SelectItem>
                          <SelectItem value="it">IT</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="role" className="text-blue-200/60">Role</Label>
                      <Select
                        value={newEmployee.role}
                        onValueChange={(value) => setNewEmployee({ ...newEmployee, role: value as Role })}
                      >
                        <SelectTrigger className="bg-black/20 border-white/10 text-white focus:border-primary/50">
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#1a2744] border-white/10 text-white backdrop-blur-xl">
                          <SelectItem value="Manager">Manager</SelectItem>
                          <SelectItem value="Supervisor">Supervisor</SelectItem>
                          <SelectItem value="Team Leader">Team Leader</SelectItem>
                          <SelectItem value="Staff">Staff</SelectItem>
                          <SelectItem value="Casual">Casual</SelectItem>
                          <SelectItem value="Contractor">Contractor</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="remunerationLevel" className="text-blue-200/60">Remuneration Level</Label>
                      <Select
                        value={String(newEmployee.remunerationLevel)}
                        onValueChange={(value) => setNewEmployee({ ...newEmployee, remunerationLevel: value as RemunerationLevel })}
                      >
                        <SelectTrigger className="bg-black/20 border-white/10 text-white focus:border-primary/50">
                          <SelectValue placeholder="Select level" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#1a2744] border-white/10 text-white backdrop-blur-xl">
                          <SelectItem value="1">Level 1</SelectItem>
                          <SelectItem value="2">Level 2</SelectItem>
                          <SelectItem value="3">Level 3</SelectItem>
                          <SelectItem value="4">Level 4</SelectItem>
                          <SelectItem value="5">Level 5</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Button
                      onClick={handleAddEmployee}
                      type="button"
                      className="w-full bg-primary hover:bg-primary/90 text-white shadow-glow mt-4"
                    >
                      Add Employee
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </motion.div>

            {/* Employee List */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="col-span-1 lg:col-span-2"
            >
              <Card className="border border-white/5 bg-[#1a2744]/30 backdrop-blur-xl shadow-xl h-full">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-white flex items-center gap-2">
                    <Users className="h-5 w-5 text-purple-400" />
                    Employee Directory
                  </CardTitle>
                  <div className="relative w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                    <Input placeholder="Search employees..." className="bg-black/20 border-white/10 pl-9 text-white h-9 focus:border-primary/50" />
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-white/5 border-b border-white/5">
                        <TableRow className="border-white/5 hover:bg-transparent">
                          <TableHead className="text-blue-200/60">Name</TableHead>
                          <TableHead className="text-blue-200/60">Department</TableHead>
                          <TableHead className="text-blue-200/60">Role</TableHead>
                          <TableHead className="text-blue-200/60">Status</TableHead>
                          <TableHead className="text-right text-blue-200/60">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loadingEmployees ? (
                          <TableRow className="border-white/5">
                            <TableCell colSpan={5} className="text-center py-12 text-blue-200/40">
                              Loading employees...
                            </TableCell>
                          </TableRow>
                        ) : employees && employees.length > 0 ? (
                          employees.map((employee) => (
                            <TableRow key={employee.id} className="border-white/5 hover:bg-white/5 transition-colors">
                              <TableCell className="font-medium text-white">
                                {employee.firstName} {employee.lastName}
                              </TableCell>
                              <TableCell className="text-blue-100/80">{employee.department}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="bg-white/5 border-white/10 text-white/70 font-normal">
                                  {employee.role}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <span className={`px-2 py-0.5 rounded-full text-xs border ${employee.status === 'active'
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                    : 'bg-red-500/10 text-red-400 border-red-500/20'
                                  }`}>
                                  {employee.status || 'active'}
                                </span>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button variant="ghost" size="sm" className="text-blue-200/60 hover:text-white hover:bg-white/10">
                                  Edit
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow className="border-white/5">
                            <TableCell colSpan={5} className="text-center py-12 text-blue-200/40">
                              No employees found
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </TabsContent>

        <TabsContent value="database" className="outline-none">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Database Operations */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card className="border border-white/5 bg-[#1a2744]/30 backdrop-blur-xl shadow-xl h-full">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <HardDrive className="h-5 w-5 text-cyan-400" />
                    Database Operations
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="p-4 border border-amber-500/30 bg-amber-500/10 rounded-xl flex items-start gap-4">
                    <div className="p-2 rounded-lg bg-amber-500/20 text-amber-500 mt-0.5">
                      <AlertCircle className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-amber-500">Warning</p>
                      <p className="text-xs text-amber-200/80 mt-1 leading-relaxed">
                        Database operations can permanently modify or delete data. Please ensure you have proper backups before proceeding.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <div className="flex justify-between items-center p-4 border border-white/5 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400">
                          <Download className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">Export Database</p>
                          <p className="text-xs text-blue-200/40">Download a copy of the entire database</p>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="border-white/10 bg-black/20 text-white hover:bg-white/10">
                        Export
                      </Button>
                    </div>

                    <div className="flex justify-between items-center p-4 border border-white/5 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400">
                          <Upload className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">Import Data</p>
                          <p className="text-xs text-blue-200/40">Import records from CSV or JSON file</p>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="border-white/10 bg-black/20 text-white hover:bg-white/10">
                        Import
                      </Button>
                    </div>

                    <div className="flex justify-between items-center p-4 border border-white/5 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-white/10 text-white/60">
                          <Trash2 className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">Clear Test Data</p>
                          <p className="text-xs text-blue-200/40">Remove all test and demo records</p>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="border-white/10 bg-black/20 text-white hover:bg-white/10">
                        Clear
                      </Button>
                    </div>

                    <div className="flex justify-between items-center p-4 border border-red-500/20 rounded-xl bg-red-500/5 hover:bg-red-500/10 transition-colors group">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-red-500/20 text-red-500 group-hover:text-red-400">
                          <AlertCircle className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-red-400">Reset Database</p>
                          <p className="text-xs text-red-400/60">Restore database to default state</p>
                        </div>
                      </div>
                      <Button variant="destructive" size="sm" onClick={handleRestoreDatabase} className="bg-red-500/80 hover:bg-red-600">
                        Reset
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Data Metrics */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Card className="border border-white/5 bg-[#1a2744]/30 backdrop-blur-xl shadow-xl h-full">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Activity className="h-5 w-5 text-emerald-400" />
                    Data Metrics
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-5 rounded-2xl bg-white/5 border border-white/5 flex flex-col justify-between h-32 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-16 h-16 bg-blue-500/20 rounded-full blur-xl -translate-y-1/2 translate-x-1/2"></div>
                        <p className="text-xs text-blue-200/60 uppercase tracking-wider font-semibold">Total Employees</p>
                        <p className="text-4xl font-bold text-white group-hover:text-blue-200 transition-colors">142</p>
                      </div>
                      <div className="p-5 rounded-2xl bg-white/5 border border-white/5 flex flex-col justify-between h-32 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-16 h-16 bg-purple-500/20 rounded-full blur-xl -translate-y-1/2 translate-x-1/2"></div>
                        <p className="text-xs text-blue-200/60 uppercase tracking-wider font-semibold">Total Shifts</p>
                        <p className="text-4xl font-bold text-white group-hover:text-purple-200 transition-colors">1,248</p>
                      </div>
                      <div className="p-5 rounded-2xl bg-white/5 border border-white/5 flex flex-col justify-between h-32 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-500/20 rounded-full blur-xl -translate-y-1/2 translate-x-1/2"></div>
                        <p className="text-xs text-blue-200/60 uppercase tracking-wider font-semibold">Active Templates</p>
                        <p className="text-4xl font-bold text-white group-hover:text-emerald-200 transition-colors">24</p>
                      </div>
                      <div className="p-5 rounded-2xl bg-white/5 border border-white/5 flex flex-col justify-between h-32 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-16 h-16 bg-amber-500/20 rounded-full blur-xl -translate-y-1/2 translate-x-1/2"></div>
                        <p className="text-xs text-blue-200/60 uppercase tracking-wider font-semibold">Database Size</p>
                        <p className="text-4xl font-bold text-white group-hover:text-amber-200 transition-colors">438 MB</p>
                      </div>
                    </div>

                    <div className="p-6 rounded-2xl bg-white/5 border border-white/5">
                      <p className="text-sm font-medium mb-3 text-white">Storage Usage</p>
                      <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden p-0.5">
                        <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full shadow-glow" style={{ width: '38%' }}></div>
                      </div>
                      <div className="flex justify-between mt-3 text-xs text-blue-200/60">
                        <span>438 MB used</span>
                        <span>1.2 GB total</span>
                      </div>
                    </div>

                    <div className="p-6 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium mb-1 text-white">Last Backup</p>
                        <p className="text-xs text-blue-200/60">3 days ago</p>
                      </div>
                      <div className="text-right">
                        <p className="text-white/80 font-mono text-sm">2023-07-05 09:14:22</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </TabsContent>

        <TabsContent value="system" className="outline-none">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* General Settings */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card className="border border-white/5 bg-[#1a2744]/30 backdrop-blur-xl shadow-xl h-full">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Settings className="h-5 w-5 text-white/60" />
                    General Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="companyName" className="text-blue-200/60">Company Name</Label>
                    <Input id="companyName" defaultValue="ICC Sydney" className="bg-black/20 border-white/10 text-white focus:border-primary/50" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="timezone" className="text-blue-200/60">System Timezone</Label>
                    <Select defaultValue="Australia/Sydney">
                      <SelectTrigger className="bg-black/20 border-white/10 text-white focus:border-primary/50">
                        <SelectValue placeholder="Select timezone" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a2744] border-white/10 text-white backdrop-blur-xl">
                        <SelectItem value="Australia/Sydney">Australia/Sydney</SelectItem>
                        <SelectItem value="Australia/Melbourne">Australia/Melbourne</SelectItem>
                        <SelectItem value="Australia/Brisbane">Australia/Brisbane</SelectItem>
                        <SelectItem value="Australia/Perth">Australia/Perth</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="dateFormat" className="text-blue-200/60">Date Format</Label>
                    <Select defaultValue="DD/MM/YYYY">
                      <SelectTrigger className="bg-black/20 border-white/10 text-white focus:border-primary/50">
                        <SelectValue placeholder="Select format" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a2744] border-white/10 text-white backdrop-blur-xl">
                        <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                        <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                        <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="timeFormat" className="text-blue-200/60">Time Format</Label>
                    <Select defaultValue="12h">
                      <SelectTrigger className="bg-black/20 border-white/10 text-white focus:border-primary/50">
                        <SelectValue placeholder="Select format" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a2744] border-white/10 text-white backdrop-blur-xl">
                        <SelectItem value="12h">12-hour (AM/PM)</SelectItem>
                        <SelectItem value="24h">24-hour</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button onClick={() => handleSystemSettingSave("General Settings")} className="w-full bg-primary hover:bg-primary/90 text-white shadow-glow mt-4">
                    <Save className="h-4 w-4 mr-2" />
                    Save Changes
                  </Button>
                </CardContent>
              </Card>
            </motion.div>

            {/* Advanced Settings */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card className="border border-white/5 bg-[#1a2744]/30 backdrop-blur-xl shadow-xl h-full">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Shield className="h-5 w-5 text-white/60" />
                    Advanced Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="maxShiftHours" className="text-blue-200/60">Maximum Shift Hours</Label>
                    <Input id="maxShiftHours" type="number" defaultValue="12" className="bg-black/20 border-white/10 text-white focus:border-primary/50" />
                    <p className="text-xs text-white/40">Maximum allowed hours for a single shift</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="maxWeeklyHours" className="text-blue-200/60">Maximum Weekly Hours</Label>
                    <Input id="maxWeeklyHours" type="number" defaultValue="48" className="bg-black/20 border-white/10 text-white focus:border-primary/50" />
                    <p className="text-xs text-white/40">Maximum allowed hours per week per employee</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notificationWindow" className="text-blue-200/60">Notification Window (Days)</Label>
                    <Input id="notificationWindow" type="number" defaultValue="7" className="bg-black/20 border-white/10 text-white focus:border-primary/50" />
                    <p className="text-xs text-white/40">Days in advance to send roster notifications</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="dataRetention" className="text-blue-200/60">Data Retention Period (Months)</Label>
                    <Input id="dataRetention" type="number" defaultValue="36" className="bg-black/20 border-white/10 text-white focus:border-primary/50" />
                    <p className="text-xs text-white/40">How long to keep historical data</p>
                  </div>

                  <Button onClick={() => handleSystemSettingSave("Advanced Settings")} className="w-full bg-primary hover:bg-primary/90 text-white shadow-glow mt-4">
                    <Save className="h-4 w-4 mr-2" />
                    Save Changes
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ConfigurationsPage;
