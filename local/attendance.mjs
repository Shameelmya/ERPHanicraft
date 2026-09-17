const fail=(message,status=422)=>{const error=new Error(message);error.status=status;throw error;};
export const todayIST=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
export function validMonth(value){if(!/^\d{4}-\d{2}$/.test(value||''))fail('Enter a valid salary month.');const month=Number(value.slice(5));if(month<1||month>12)fail('Enter a valid salary month.');return value;}
export function monthDates(month){validMonth(month);const [year,value]=month.split('-').map(Number),days=new Date(Date.UTC(year,value,0)).getUTCDate();return Array.from({length:days},(_,index)=>`${month}-${String(index+1).padStart(2,'0')}`);}
export const expectedWorkday=date=>new Date(date+'T00:00:00Z').getUTCDay()!==0;
const roundMoney=value=>Math.round(value);
export function payrollPreview(store,month,employeeId){
 validMonth(month);const employee=store.get('employees',employeeId);if(!employee)fail('Employee not found.',404);if(employee.role==='MD')fail('MD is excluded from staff payroll.');
 const dates=monthDates(month),joined=employee.joined||'0000-00-00',today=todayIST(),workingDates=dates.filter(date=>expectedWorkday(date)&&date>=joined&&date<=today);const rows=store.list('attendance').filter(row=>row.employeeId===employeeId&&row.date.startsWith(month));
 const byDate=new Map(rows.map(row=>[row.date,row])),counts={PRESENT:0,HALF_DAY:0,PAID_LEAVE:0,UNPAID_LEAVE:0,ABSENT:0,HOLIDAY:0};for(const row of rows)if(counts[row.status]!==undefined)counts[row.status]++;
 let paidUnits=0,markedWorkdays=0;for(const date of workingDates){const row=byDate.get(date);if(!row)continue;markedWorkdays++;if(['PRESENT','PAID_LEAVE','HOLIDAY'].includes(row.status))paidUnits+=1;else if(row.status==='HALF_DAY')paidUnits+=.5;}
 const workingDays=workingDates.length,unmarkedDays=Math.max(0,workingDays-markedWorkdays),monthlySalary=employee.monthlySalary||0,overtimeRate=employee.overtimeRate||0,overtimeMinutes=rows.reduce((total,row)=>total+(row.overtimeMinutes||0),0),baseEarned=workingDays?roundMoney(monthlySalary*Math.min(workingDays,paidUnits)/workingDays):0,overtimePay=roundMoney(overtimeRate*overtimeMinutes/60);
 return {employeeId,employeeName:employee.name,role:employee.role,month,monthlySalary,overtimeRate,workingDays,paidDays:paidUnits,unmarkedDays,absenceDays:Math.max(0,workingDays-paidUnits),counts,overtimeMinutes,baseEarned,overtimePay,grossPay:baseEarned+overtimePay,calculatedAt:new Date().toISOString()};
}
export function attendanceView(store,user,month,employeeId){
 validMonth(month);const manager=['MD','GM'].includes(user.role),target=manager?employeeId||'':user.id;if(employeeId&&!manager&&employeeId!==user.id)fail('You can view only your own attendance.',403);
 let employees=manager?store.list('employees').filter(employee=>employee.active&&employee.role!=='MD'):[user];if(target)employees=employees.filter(employee=>employee.id===target);
 const allowed=new Set(employees.map(employee=>employee.id));const rows=store.list('attendance').filter(row=>row.date.startsWith(month)&&allowed.has(row.employeeId)).sort((a,b)=>b.date.localeCompare(a.date)||a.employeeId.localeCompare(b.employeeId));
 const summaries=employees.map(employee=>payrollPreview(store,month,employee.id));return {month,today:todayIST(),rows,summaries};
}
