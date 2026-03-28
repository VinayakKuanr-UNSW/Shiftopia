
import { useQuery } from '@tanstack/react-query';
import { employeeService } from '../api/employee.service';

export const useEmployees = () => {
  // Get all employees, optionally scoped to specific orgs/depts
  const useAllEmployees = (orgIds?: string[], deptIds?: string[]) => {
    return useQuery({
      queryKey: ['employees', orgIds, deptIds],
      queryFn: () => employeeService.getAllEmployees(orgIds, deptIds),
    });
  };
  
  // Get employee by ID
  const useEmployee = (id: string) => {
    return useQuery({
      queryKey: ['employees', id],
      queryFn: () => employeeService.getEmployeeById(id),
      enabled: !!id
    });
  };
  
  // Get employees by department
  const useEmployeesByDepartment = (department: string) => {
    return useQuery({
      queryKey: ['employees', 'department', department],
      queryFn: () => employeeService.getEmployeesByDepartment(department),
      enabled: !!department
    });
  };
  
  // Get available employees for shift
  const useAvailableEmployeesForShift = (
    date: string, 
    department: string, 
    role: string, 
    startTime: string, 
    endTime: string
  ) => {
    return useQuery({
      queryKey: ['employees', 'available', date, department, role, startTime, endTime],
      queryFn: () => employeeService.getAvailableEmployeesForShift(date, department, role, startTime, endTime),
      enabled: !!date && !!department && !!role && !!startTime && !!endTime
    });
  };
  
  return {
    useAllEmployees,
    useEmployee,
    useEmployeesByDepartment,
    useAvailableEmployeesForShift
  };
};
