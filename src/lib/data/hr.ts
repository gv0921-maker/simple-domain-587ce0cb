// HR/Employees module data layer

export interface Employee {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  phone?: string;
  departmentId: string;
  departmentName: string;
  jobTitle: string;
  managerId?: string;
  managerName?: string;
  hireDate: string;
  status: 'active' | 'on_leave' | 'terminated';
  workLocation: string;
  avatar?: string;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  managerId?: string;
  managerName?: string;
  parentId?: string;
  employeeCount: number;
  color: string;
}

export interface Attendance {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  workedHours: number;
  status: 'present' | 'absent' | 'late' | 'half_day' | 'remote';
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  type: 'annual' | 'sick' | 'unpaid' | 'maternity' | 'paternity' | 'other';
  startDate: string;
  endDate: string;
  days: number;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  approvedBy?: string;
}

export interface Contract {
  id: string;
  employeeId: string;
  employeeName: string;
  type: 'permanent' | 'temporary' | 'contractor' | 'intern';
  startDate: string;
  endDate?: string;
  salary: number;
  currency: string;
  status: 'active' | 'expired' | 'terminated';
}

// Mock data
let employees: Employee[] = [];

let departments: Department[] = [];

let attendance: Attendance[] = [];

let leaveRequests: LeaveRequest[] = [];

let contracts: Contract[] = [];

// CRUD operations
export function getEmployees() {
  return [...employees];
}

export function getEmployee(id: string) {
  return employees.find(e => e.id === id);
}

export function createEmployee(data: Omit<Employee, 'id' | 'employeeId'>) {
  const newId = `EMP-${String(employees.length + 1).padStart(3, '0')}`;
  const newEmployee: Employee = {
    ...data,
    id: newId,
    employeeId: `E${String(employees.length + 1).padStart(3, '0')}`,
  };
  employees = [...employees, newEmployee];
  return newEmployee;
}

export function updateEmployee(id: string, data: Partial<Employee>) {
  employees = employees.map(e => e.id === id ? { ...e, ...data } : e);
  return employees.find(e => e.id === id);
}

export function deleteEmployee(id: string) {
  employees = employees.filter(e => e.id !== id);
}

export function getDepartments() {
  return [...departments];
}

export function createDepartment(data: Omit<Department, 'id' | 'employeeCount'>) {
  const newId = `DEPT-${String(departments.length + 1).padStart(3, '0')}`;
  const newDept: Department = { ...data, id: newId, employeeCount: 0 };
  departments = [...departments, newDept];
  return newDept;
}

export function updateDepartment(id: string, data: Partial<Department>) {
  departments = departments.map(d => d.id === id ? { ...d, ...data } : d);
  return departments.find(d => d.id === id);
}

export function deleteDepartment(id: string) {
  departments = departments.filter(d => d.id !== id);
}

export function getAttendance(date?: string) {
  if (date) {
    return attendance.filter(a => a.date === date);
  }
  return [...attendance];
}

export function createAttendance(data: Omit<Attendance, 'id'>) {
  const newId = `ATT-${String(attendance.length + 1).padStart(3, '0')}`;
  const newAtt: Attendance = { ...data, id: newId };
  attendance = [...attendance, newAtt];
  return newAtt;
}

export function getLeaveRequests() {
  return [...leaveRequests];
}

export function createLeaveRequest(data: Omit<LeaveRequest, 'id'>) {
  const newId = `LR-${String(leaveRequests.length + 1).padStart(3, '0')}`;
  const newLR: LeaveRequest = { ...data, id: newId };
  leaveRequests = [...leaveRequests, newLR];
  return newLR;
}

export function updateLeaveRequest(id: string, data: Partial<LeaveRequest>) {
  leaveRequests = leaveRequests.map(lr => lr.id === id ? { ...lr, ...data } : lr);
  return leaveRequests.find(lr => lr.id === id);
}

export function getContracts() {
  return [...contracts];
}

export function createContract(data: Omit<Contract, 'id'>) {
  const newId = `CON-${String(contracts.length + 1).padStart(3, '0')}`;
  const newContract: Contract = { ...data, id: newId };
  contracts = [...contracts, newContract];
  return newContract;
}

// HR metrics
export function getHRMetrics() {
  const totalEmployees = employees.filter(e => e.status !== 'terminated').length;
  const activeEmployees = employees.filter(e => e.status === 'active').length;
  const onLeave = employees.filter(e => e.status === 'on_leave').length;
  const pendingLeaves = leaveRequests.filter(lr => lr.status === 'pending').length;
  const avgTenure = employees.reduce((sum, e) => {
    const years = (new Date().getTime() - new Date(e.hireDate).getTime()) / (1000 * 60 * 60 * 24 * 365);
    return sum + years;
  }, 0) / employees.length;

  return {
    totalEmployees,
    activeEmployees,
    onLeave,
    pendingLeaves,
    avgTenure: Math.round(avgTenure * 10) / 10,
    departmentCount: departments.length,
  };
}
