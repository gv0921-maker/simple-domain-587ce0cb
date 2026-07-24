import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { CustomizationProvider } from "@/contexts/CustomizationContext";
import { AccessibilityProvider } from "@/contexts/AccessibilityContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Auth pages
const LoginPage = lazy(() => import("@/pages/auth/LoginPage"));
const HomePage = lazy(() => import("@/pages/HomePage"));

// Inventory pages
const InventoryOverview = lazy(() => import("@/pages/inventory/InventoryOverview"));
const ItoDetail = lazy(() => import("@/pages/inventory/ItoDetail"));
const ProductsList = lazy(() => import("@/pages/inventory/ProductsList"));
const ProductDetail = lazy(() => import("@/pages/inventory/ProductDetail"));
const WarehousesList = lazy(() => import("@/pages/inventory/WarehousesList"));
const WarehouseLocations = lazy(() => import("@/pages/inventory/WarehouseLocations"));
const StockMoves = lazy(() => import("@/pages/inventory/StockMoves"));
const InventoryConfiguration = lazy(() => import("@/pages/inventory/InventoryConfiguration"));
const InventorySetupCategories = lazy(() => import("@/pages/inventory/setup/InventorySetupCategories"));
const InventorySetupAttributes = lazy(() => import("@/pages/inventory/setup/InventorySetupAttributes"));
const InventorySetupUnits = lazy(() => import("@/pages/inventory/setup/InventorySetupUnits"));
const InventorySetupOperationTypes = lazy(() => import("@/pages/inventory/setup/InventorySetupOperationTypes"));
const InventoryOperationsOverview = lazy(() => import("@/pages/inventory/InventoryOperationsOverview"));
const InventoryReporting = lazy(() => import("@/pages/inventory/InventoryReporting"));
const InventoryAdjustments = lazy(() => import("@/pages/inventory/InventoryAdjustments"));
const ReorderRules = lazy(() => import("@/pages/inventory/ReorderRules"));
const ReorderRuleForm = lazy(() => import("@/pages/inventory/ReorderRuleForm"));
const ProductScanLookup = lazy(() => import("@/pages/inventory/ProductScanLookup"));

// Barcode workspace (Phase 1 Batch 2)
const ScanQueueDashboard = lazy(() => import("@/pages/barcode/ScanQueueDashboard"));
const ScanWorkspace = lazy(() => import("@/pages/barcode/ScanWorkspace"));
const LabelsPage = lazy(() => import("@/pages/barcode/LabelsPage"));
const ScanHistoryPage = lazy(() => import("@/pages/barcode/ScanHistoryPage"));
const StockDashboard = lazy(() => import("@/pages/inventory/StockDashboard"));
const DeliveryNotesList = lazy(() => import("@/pages/inventory/DeliveryNotesList"));
const DeliveryNoteDetail = lazy(() => import("@/pages/inventory/DeliveryNoteDetail"));
const DeliveryNotePrint = lazy(() => import("@/pages/inventory/DeliveryNotePrint"));
const GoodsReceiptsList = lazy(() => import("@/pages/inventory/GoodsReceiptsList"));
const GoodsReceiptWizard = lazy(() => import("@/pages/inventory/GoodsReceiptWizard"));
const CorrectionOrdersList = lazy(() => import("@/pages/inventory/CorrectionOrdersList"));
const CorrectionOrderDetail = lazy(() => import("@/pages/inventory/CorrectionOrderDetail"));
const InternalMovementsList = lazy(() => import("@/pages/inventory/InternalMovementsList"));
const InternalMovementDetail = lazy(() => import("@/pages/inventory/InternalMovementDetail"));
const InternalMovementForm = lazy(() => import("@/pages/inventory/InternalMovementForm"));
const StockCountsList = lazy(() => import("@/pages/inventory/StockCountsList"));
const StockCountDetail = lazy(() => import("@/pages/inventory/StockCountDetail"));
const WriteOffsList = lazy(() => import("@/pages/inventory/WriteOffsList"));
const WriteOffDetail = lazy(() => import("@/pages/inventory/WriteOffDetail"));

// Sales pages
const SalesOverview = lazy(() => import("@/pages/sales/SalesOverview"));
const QuotationForm = lazy(() => import("@/pages/sales/QuotationForm"));
const QuotationsList = lazy(() => import("@/pages/sales/QuotationsList"));
const SalesOrdersList = lazy(() => import("@/pages/sales/SalesOrdersList"));
const SalesOrderForm = lazy(() => import("@/pages/sales/SalesOrderForm"));
const SubscriptionsList = lazy(() => import("@/pages/sales/SubscriptionsList"));
const SubscriptionForm = lazy(() => import("@/pages/sales/SubscriptionForm"));
const PricelistsPage = lazy(() => import("@/pages/sales/PricelistsPage"));
const PricelistForm = lazy(() => import("@/pages/sales/PricelistForm"));
const SalesReports = lazy(() => import("@/pages/sales/SalesReports"));
const PromotionsPage = lazy(() => import("@/pages/sales/PromotionsPage"));
const CustomerPortal = lazy(() => import("@/pages/sales/CustomerPortal"));
const CustomerPortalQuotation = lazy(() => import("@/pages/sales/CustomerPortalQuotation"));

// Manufacturing pages
const ManufacturingOverview = lazy(() => import("@/pages/manufacturing/ManufacturingOverview"));
const WorkOrdersList = lazy(() => import("@/pages/manufacturing/WorkOrdersList"));
const WorkOrderForm = lazy(() => import("@/pages/manufacturing/WorkOrderForm"));
const WorkOrderDetail = lazy(() => import("@/pages/manufacturing/WorkOrderDetail"));
const ShopFloorHome = lazy(() => import("@/pages/shopfloor/ShopFloorHome"));
const ShopFloorWorkOrderDetail = lazy(() => import("@/pages/shopfloor/ShopFloorWorkOrderDetail"));
const FactoryInventoryPage = lazy(() => import("@/pages/shopfloor/FactoryInventory"));

// CRM pages
const CRMOverview = lazy(() => import("@/pages/crm/CRMOverview"));
const CRMPipeline = lazy(() => import("@/pages/crm/CRMPipeline"));
const CRMContactsList = lazy(() => import("@/pages/crm/CRMContactsList"));
const LeadsPage = lazy(() => import("@/pages/crm/LeadsPage"));
const CRMContactDetail = lazy(() => import("@/pages/crm/CRMContactDetail"));
const ContactForm = lazy(() => import("@/pages/crm/ContactForm"));
const OpportunityForm = lazy(() => import("@/pages/crm/OpportunityForm"));
const OpportunityDetail = lazy(() => import("@/pages/crm/OpportunityDetail"));

// Invoicing pages
const InvoicesList = lazy(() => import("@/pages/invoicing/InvoicesList"));
const InvoiceForm = lazy(() => import("@/pages/invoicing/InvoiceForm"));
const InvoiceDetail = lazy(() => import("@/pages/invoicing/InvoiceDetail"));
const BillsList = lazy(() => import("@/pages/invoicing/BillsList"));
const WarrantyBillsList = lazy(() => import("@/pages/invoicing/WarrantyBillsList"));
const FactoryBillsList = lazy(() => import("@/pages/invoicing/FactoryBillsList"));
const PaymentsList = lazy(() => import("@/pages/invoicing/PaymentsList"));

// Settings pages
const GeneralSettings = lazy(() => import("@/pages/settings/GeneralSettings"));
const CustomizationSettings = lazy(() => import("@/pages/settings/CustomizationSettings"));
const StudioEditor = lazy(() => import("@/pages/settings/StudioEditor"));
const UsersManagement = lazy(() => import("@/pages/settings/UsersManagement"));
const RolesManagement = lazy(() => import("@/pages/settings/RolesManagement"));
const AuditLogs = lazy(() => import("@/pages/settings/AuditLogs"));
const BackupsSettings = lazy(() => import("@/pages/settings/BackupsSettings"));
const NumberingSettings = lazy(() => import("@/pages/settings/NumberingSettings"));
const CRMPipelinesSettings = lazy(() => import("@/pages/settings/CRMPipelinesSettings"));
const AccessibilitySettings = lazy(() => import("@/pages/settings/AccessibilitySettings"));
const PriceApprovalsPage = lazy(() => import("@/pages/settings/PriceApprovalsPage"));
const CompanySettings = lazy(() => import("@/pages/settings/CompanySettings"));
const PaymentAccountsSettings = lazy(() => import("@/pages/settings/PaymentAccountsSettings"));
const VendorsSettings = lazy(() => import("@/pages/settings/VendorsSettings"));
const WorkSchedulesSettings = lazy(() => import("@/pages/settings/WorkSchedulesSettings"));
const HolidaysSettings = lazy(() => import("@/pages/settings/HolidaysSettings"));
const PayrollSettingsPage = lazy(() => import("@/pages/settings/PayrollSettings"));
import { SuperAdminRoute } from "@/components/SuperAdminRoute";
import { RouteGuard } from "@/components/auth/RouteGuard";
const OrgChartPage = lazy(() => import("@/pages/employees/OrgChart"));
const UnifiedCalendarPage = lazy(() => import("@/pages/calendar/UnifiedCalendarPage"));
const DataHealth = lazy(() => import("@/pages/admin/DataHealth"));

// Vendor Orders module
const VendorOrdersList = lazy(() => import("@/pages/vendor-orders/VendorOrdersList"));
const VendorOrderForm = lazy(() => import("@/pages/vendor-orders/VendorOrderForm"));
const VendorOrderDetail = lazy(() => import("@/pages/vendor-orders/VendorOrderDetail"));

// Returns module
const ReturnsList = lazy(() => import("@/pages/returns/ReturnsList"));
const ReturnNew = lazy(() => import("@/pages/returns/ReturnNew"));
const ReturnDetail = lazy(() => import("@/pages/returns/ReturnDetail"));

// Credit Notes & Refunds
const CreditNotesList = lazy(() => import("@/pages/credit-notes/CreditNotesList"));
const CreditNoteDetail = lazy(() => import("@/pages/credit-notes/CreditNoteDetail"));
const RefundsList = lazy(() => import("@/pages/refunds/RefundsList"));
const RefundDetail = lazy(() => import("@/pages/refunds/RefundDetail"));

// Print framework (Phase 1 Batch 4)
const PrintRoute = lazy(() => import("@/pages/print/PrintRoute"));

const NotFound = lazy(() => import("@/pages/NotFound"));

// Dashboards module
const DashboardsHome = lazy(() => import("@/pages/dashboards/DashboardsHome"));
const SuperAdminDashboard = lazy(() => import("@/pages/dashboards/SuperAdminDashboard"));
const SalesManagerDashboard = lazy(() => import("@/pages/dashboards/SalesManagerDashboard"));
const SalesRepDashboard = lazy(() => import("@/pages/dashboards/SalesRepDashboard"));
const WarehouseDashboard = lazy(() => import("@/pages/dashboards/WarehouseDashboard"));
const AccountantDashboard = lazy(() => import("@/pages/dashboards/AccountantDashboard"));
const HRDashboard = lazy(() => import("@/pages/dashboards/HRDashboard"));
const EmployeeDashboard = lazy(() => import("@/pages/dashboards/EmployeeDashboard"));

// Chat module
const ChatPage = lazy(() => import("@/pages/chat/ChatPage"));
const ChatDMRedirect = lazy(() => import("@/pages/chat/ChatDMRedirect"));
const MentionsPage = lazy(() => import("@/pages/chat/MentionsPage"));
const ChatSearchPage = lazy(() => import("@/pages/chat/ChatSearchPage"));
const ChatNotificationsPage = lazy(() => import("@/pages/chat/ChatNotificationsPage"));

// HR/Employees pages
const EmployeesOverview = lazy(() => import("@/pages/employees/EmployeesOverview"));
const EmployeesDirectory = lazy(() => import("@/pages/employees/EmployeesDirectory"));
const EmployeeForm = lazy(() => import("@/pages/employees/EmployeeForm"));
const EmployeeDetail = lazy(() => import("@/pages/employees/EmployeeDetail"));
const DepartmentsList = lazy(() => import("@/pages/employees/DepartmentsList"));
const DepartmentDetail = lazy(() => import("@/pages/employees/DepartmentDetail"));
const ContractsList = lazy(() => import("@/pages/employees/ContractsList"));
const ContractForm = lazy(() => import("@/pages/employees/ContractForm"));
const ContractDetail = lazy(() => import("@/pages/employees/ContractDetail"));

// Attendance pages (HR Batch 2)
const ClockIn = lazy(() => import("@/pages/attendance/ClockIn"));
const MyAttendance = lazy(() => import("@/pages/attendance/MyAttendance"));
const TeamAttendance = lazy(() => import("@/pages/attendance/TeamAttendance"));
const AdminAttendance = lazy(() => import("@/pages/attendance/AdminAttendance"));
const AdminImport = lazy(() => import("@/pages/attendance/AdminImport"));
const LocationsPage = lazy(() => import("@/pages/attendance/Locations"));
const HolidaysPage = lazy(() => import("@/pages/attendance/Holidays"));
const WorkSchedulesPage = lazy(() => import("@/pages/attendance/WorkSchedules"));
const RosterPlanning = lazy(() => import("@/pages/attendance/RosterPlanning"));
const RosterReschedule = lazy(() => import("@/pages/attendance/RosterReschedule"));

// Leave pages (HR Batch 3)
const MyLeaves = lazy(() => import("@/pages/leave/MyLeaves"));
const ApplyLeave = lazy(() => import("@/pages/leave/ApplyLeave"));
const LeaveDetail = lazy(() => import("@/pages/leave/LeaveDetail"));
const TeamLeaves = lazy(() => import("@/pages/leave/TeamLeaves"));
const LeaveCalendar = lazy(() => import("@/pages/leave/LeaveCalendar"));
const AdminRequests = lazy(() => import("@/pages/leave/AdminRequests"));
const AdminBalances = lazy(() => import("@/pages/leave/AdminBalances"));
const AdminEntitlements = lazy(() => import("@/pages/leave/AdminEntitlements"));
const AdminLeaveTypes = lazy(() => import("@/pages/leave/AdminLeaveTypes"));
const AdminCompOff = lazy(() => import("@/pages/leave/AdminCompOff"));
const AdminApprovals = lazy(() => import("@/pages/leave/AdminApprovals"));
const WorkSchedulePage = lazy(() => import("@/pages/work-schedule/WorkSchedulePage"));
const AdminWorkSchedule = lazy(() => import("@/pages/work-schedule/AdminWorkSchedule"));

// Payroll pages (HR Batch 4)
const PayrollDashboard = lazy(() => import("@/pages/payroll/PayrollDashboard"));
const PayrollPeriodsList = lazy(() => import("@/pages/payroll/PayrollPeriodsList"));
const PayrollPeriodDetail = lazy(() => import("@/pages/payroll/PayrollPeriodDetail"));
const PayslipDetail = lazy(() => import("@/pages/payroll/PayslipDetail"));
const MyPayslips = lazy(() => import("@/pages/payroll/MyPayslips"));
const AdminComponents = lazy(() => import("@/pages/payroll/admin/AdminComponents"));
const AdminPayrollSettings = lazy(() => import("@/pages/payroll/admin/AdminSettings"));
const AdminLoans = lazy(() => import("@/pages/payroll/admin/AdminLoans"));
const AdminAdvances = lazy(() => import("@/pages/payroll/admin/AdminAdvances"));

// Appraisals pages (HR Batch 5)
const AppraisalsOverview = lazy(() => import("@/pages/appraisals/AppraisalsOverview"));
const MyAppraisals = lazy(() => import("@/pages/appraisals/MyAppraisals"));
const AppraisalSelfReview = lazy(() => import("@/pages/appraisals/SelfReview"));
const AppraisalManagerReview = lazy(() => import("@/pages/appraisals/ManagerReview"));
const AppraisalHRReview = lazy(() => import("@/pages/appraisals/HRReview"));
const AppraisalDetail = lazy(() => import("@/pages/appraisals/AppraisalDetail"));
const TeamAppraisals = lazy(() => import("@/pages/appraisals/TeamAppraisals"));
const AdminCycles = lazy(() => import("@/pages/appraisals/admin/AdminCycles"));
const AdminCycleDetail = lazy(() => import("@/pages/appraisals/admin/CycleDetail"));
const AdminAppraisalTemplates = lazy(() => import("@/pages/appraisals/admin/AdminTemplates"));
const AdminAppraisalReports = lazy(() => import("@/pages/appraisals/admin/AdminReports"));

// Reports module
const ReportsHub = lazy(() => import("@/pages/reports/ReportsHub"));
const ReportPage = lazy(() => import("@/pages/reports/ReportPage"));
const SalesReportsLanding = lazy(() => import("@/pages/reports/modulePages").then(m => ({ default: m.SalesReportsLanding })));
const InventoryReportsLanding = lazy(() => import("@/pages/reports/modulePages").then(m => ({ default: m.InventoryReportsLanding })));
const ManufacturingReportsLanding = lazy(() => import("@/pages/reports/modulePages").then(m => ({ default: m.ManufacturingReportsLanding })));
const InvoicingReportsLanding = lazy(() => import("@/pages/reports/modulePages").then(m => ({ default: m.InvoicingReportsLanding })));
const EmployeesReportsLanding = lazy(() => import("@/pages/reports/modulePages").then(m => ({ default: m.EmployeesReportsLanding })));
const AttendanceReportsLanding = lazy(() => import("@/pages/reports/modulePages").then(m => ({ default: m.AttendanceReportsLanding })));
const LeaveReportsLanding = lazy(() => import("@/pages/reports/modulePages").then(m => ({ default: m.LeaveReportsLanding })));
const PayrollReportsLanding = lazy(() => import("@/pages/reports/modulePages").then(m => ({ default: m.PayrollReportsLanding })));
const AppraisalsReportsLanding = lazy(() => import("@/pages/reports/modulePages").then(m => ({ default: m.AppraisalsReportsLanding })));
const CRMReportsLanding = lazy(() => import("@/pages/reports/modulePages").then(m => ({ default: m.CRMReportsLanding })));

// Notifications
const NotificationsPage = lazy(() => import("@/pages/notifications/NotificationsPage"));
const NotificationSettings = lazy(() => import("@/pages/settings/NotificationSettings"));

const queryClient = new QueryClient();

// Shown while a route's chunk is being fetched. Deliberately plain: it appears
// for a few hundred milliseconds at most on a warm cache, and a heavier
// skeleton flashing on every navigation reads worse than nothing.
function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <CustomizationProvider>
        <AccessibilityProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
          <ErrorBoundary label="App">
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Auth routes */}
            <Route path="/login" element={<LoginPage />} />

            {/* Protected routes */}
            <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />

            {/* Inventory module */}
            <Route path="/inventory" element={<ProtectedRoute><InventoryOverview /></ProtectedRoute>} />
            <Route path="/inventory/products" element={<ProtectedRoute><ProductsList /></ProtectedRoute>} />
            <Route path="/inventory/products/:id" element={<ProtectedRoute><ProductDetail /></ProtectedRoute>} />
            <Route path="/inventory/ito/:id" element={<ProtectedRoute><ItoDetail /></ProtectedRoute>} />
            <Route path="/inventory/warehouses" element={<ProtectedRoute><WarehousesList /></ProtectedRoute>} />
            <Route path="/inventory/locations" element={<ProtectedRoute><WarehouseLocations /></ProtectedRoute>} />
            <Route path="/inventory/stock-moves" element={<ProtectedRoute><StockMoves /></ProtectedRoute>} />
            <Route path="/inventory/reporting" element={<ProtectedRoute><InventoryReporting /></ProtectedRoute>} />
            <Route path="/inventory/configuration" element={<ProtectedRoute><InventoryConfiguration /></ProtectedRoute>} />
            <Route path="/inventory/setup/categories" element={<ProtectedRoute><InventorySetupCategories /></ProtectedRoute>} />
            <Route path="/inventory/setup/attributes" element={<ProtectedRoute><InventorySetupAttributes /></ProtectedRoute>} />
            <Route path="/inventory/setup/units" element={<ProtectedRoute><InventorySetupUnits /></ProtectedRoute>} />
            <Route path="/inventory/setup/operation-types" element={<ProtectedRoute><InventorySetupOperationTypes /></ProtectedRoute>} />
            <Route path="/inventory/adjustments" element={<ProtectedRoute><InventoryAdjustments /></ProtectedRoute>} />
            <Route path="/inventory/reorder-rules" element={<ProtectedRoute><ReorderRules /></ProtectedRoute>} />
            <Route path="/inventory/reorder-rules/new" element={<ProtectedRoute><ReorderRuleForm /></ProtectedRoute>} />
            <Route path="/inventory/reorder-rules/:id/edit" element={<ProtectedRoute><ReorderRuleForm /></ProtectedRoute>} />
            <Route path="/inventory/stock-dashboard" element={<ProtectedRoute><StockDashboard /></ProtectedRoute>} />
            <Route path="/inventory/delivery-notes" element={<ProtectedRoute><DeliveryNotesList /></ProtectedRoute>} />
            <Route path="/inventory/operations" element={<ProtectedRoute><InventoryOperationsOverview /></ProtectedRoute>} />
            <Route path="/inventory/delivery-notes/:id" element={<ProtectedRoute><DeliveryNoteDetail /></ProtectedRoute>} />
            <Route path="/inventory/delivery-notes/:id/print" element={<ProtectedRoute><DeliveryNotePrint /></ProtectedRoute>} />
            <Route path="/inventory/goods-receipts" element={<ProtectedRoute><GoodsReceiptsList /></ProtectedRoute>} />
            <Route path="/inventory/goods-receipts/new" element={<ProtectedRoute><GoodsReceiptWizard /></ProtectedRoute>} />
            <Route path="/inventory/goods-receipts/:id" element={<ProtectedRoute><GoodsReceiptWizard /></ProtectedRoute>} />
            <Route path="/inventory/correction-orders" element={<ProtectedRoute><CorrectionOrdersList /></ProtectedRoute>} />
            <Route path="/inventory/correction-orders/:id" element={<ProtectedRoute><CorrectionOrderDetail /></ProtectedRoute>} />
            <Route path="/inventory/internal-movements" element={<ProtectedRoute><InternalMovementsList /></ProtectedRoute>} />
            <Route path="/inventory/internal-movements/new" element={<ProtectedRoute><InternalMovementForm /></ProtectedRoute>} />
            <Route path="/inventory/internal-movements/:id" element={<ProtectedRoute><InternalMovementDetail /></ProtectedRoute>} />
            <Route path="/inventory/stock-counts" element={<ProtectedRoute><StockCountsList /></ProtectedRoute>} />
            <Route path="/inventory/stock-counts/:id" element={<ProtectedRoute><StockCountDetail /></ProtectedRoute>} />
            <Route path="/inventory/write-offs" element={<ProtectedRoute><WriteOffsList /></ProtectedRoute>} />
            <Route path="/inventory/write-offs/:id" element={<ProtectedRoute><WriteOffDetail /></ProtectedRoute>} />

            {/* Barcode module */}
            <Route path="/barcode" element={<ProtectedRoute><ScanQueueDashboard /></ProtectedRoute>} />
            <Route path="/barcode/scan/:queueId" element={<ProtectedRoute><ScanWorkspace /></ProtectedRoute>} />
            <Route path="/barcode/labels" element={<ProtectedRoute><LabelsPage /></ProtectedRoute>} />
            <Route path="/barcode/history" element={<ProtectedRoute><ScanHistoryPage /></ProtectedRoute>} />
            <Route path="/barcode/scan-lookup" element={<ProtectedRoute><ProductScanLookup /></ProtectedRoute>} />

            {/* Sales module */}
            <Route path="/sales" element={<ProtectedRoute><SalesOverview /></ProtectedRoute>} />
            <Route path="/sales/quotations" element={<ProtectedRoute><QuotationsList /></ProtectedRoute>} />
            <Route path="/sales/quotations/new" element={<ProtectedRoute><QuotationForm /></ProtectedRoute>} />
            <Route path="/sales/quotations/:id" element={<ProtectedRoute><QuotationForm /></ProtectedRoute>} />
            <Route path="/sales/quotations/:id/edit" element={<ProtectedRoute><QuotationForm /></ProtectedRoute>} />
            <Route path="/sales/orders" element={<ProtectedRoute><SalesOrdersList /></ProtectedRoute>} />
            <Route path="/sales/orders/new" element={<ProtectedRoute><SalesOrderForm /></ProtectedRoute>} />
            <Route path="/sales/orders/:id" element={<ProtectedRoute><SalesOrderForm /></ProtectedRoute>} />
            <Route path="/sales/orders/:id/edit" element={<ProtectedRoute><SalesOrderForm /></ProtectedRoute>} />
            <Route path="/sales/subscriptions" element={<ProtectedRoute><SubscriptionsList /></ProtectedRoute>} />
            <Route path="/sales/subscriptions/new" element={<ProtectedRoute><SubscriptionForm /></ProtectedRoute>} />
            <Route path="/sales/subscriptions/:id/edit" element={<ProtectedRoute><SubscriptionForm /></ProtectedRoute>} />
            <Route path="/sales/pricelists" element={<ProtectedRoute><PricelistsPage /></ProtectedRoute>} />
            <Route path="/sales/pricelists/new" element={<ProtectedRoute><PricelistForm /></ProtectedRoute>} />
            <Route path="/sales/pricelists/:id/edit" element={<ProtectedRoute><PricelistForm /></ProtectedRoute>} />
            <Route path="/sales/reports" element={<ProtectedRoute><SalesReportsLanding /></ProtectedRoute>} />
            <Route path="/sales/reports/legacy" element={<ProtectedRoute><SalesReports /></ProtectedRoute>} />
            <Route path="/sales/reports/:reportKey" element={<ProtectedRoute><ReportPage /></ProtectedRoute>} />
            <Route path="/sales/promotions" element={<ProtectedRoute><PromotionsPage /></ProtectedRoute>} />
            <Route path="/sales/customers" element={<Navigate to="/crm/contacts" replace />} />
            <Route path="/sales/customers/new" element={<Navigate to="/crm/contacts/new" replace />} />
            <Route path="/sales/customers/:id/edit" element={<Navigate to="/crm/contacts" replace />} />

            {/* Customer Portal (no auth required) */}
            <Route path="/portal" element={<CustomerPortal />} />
            <Route path="/portal/quotation/:id" element={<CustomerPortalQuotation />} />

            {/* Settings module */}
            <Route path="/settings" element={<ProtectedRoute><GeneralSettings /></ProtectedRoute>} />
            <Route path="/settings/customization" element={<ProtectedRoute><CustomizationSettings /></ProtectedRoute>} />
            <Route path="/settings/studio" element={<ProtectedRoute><StudioEditor /></ProtectedRoute>} />
            <Route path="/settings/users" element={<ProtectedRoute><UsersManagement /></ProtectedRoute>} />
            <Route path="/settings/roles" element={<ProtectedRoute><RolesManagement /></ProtectedRoute>} />
            <Route path="/settings/audit" element={<RouteGuard superAdmin denyMessage="Audit Logs are restricted to Super Admin."><AuditLogs /></RouteGuard>} />
            <Route path="/audit-logs" element={<RouteGuard superAdmin denyMessage="Audit Logs are restricted to Super Admin."><AuditLogs /></RouteGuard>} />
            <Route path="/settings/backups" element={<ProtectedRoute><BackupsSettings /></ProtectedRoute>} />
            <Route path="/settings/numbering" element={<RouteGuard superAdmin denyMessage="Numbering settings are restricted to Super Admin."><NumberingSettings /></RouteGuard>} />
            <Route path="/settings/crm-pipelines" element={<ProtectedRoute><CRMPipelinesSettings /></ProtectedRoute>} />
            <Route path="/settings/accessibility" element={<ProtectedRoute><AccessibilitySettings /></ProtectedRoute>} />
            <Route path="/settings/price-approvals" element={<ProtectedRoute><PriceApprovalsPage /></ProtectedRoute>} />
            <Route path="/settings/company" element={<RouteGuard superAdmin denyMessage="Company settings are restricted to Super Admin."><CompanySettings /></RouteGuard>} />
            <Route path="/settings/payment-accounts" element={<RouteGuard superAdmin denyMessage="Payment Accounts are restricted to Super Admin."><PaymentAccountsSettings /></RouteGuard>} />
            <Route path="/settings/vendors" element={<RouteGuard adminOrSuper denyMessage="Vendors require Admin access."><VendorsSettings /></RouteGuard>} />
            <Route path="/settings/work-schedules" element={<RouteGuard superAdmin denyMessage="Work Schedules are restricted to Super Admin."><WorkSchedulesSettings /></RouteGuard>} />
            <Route path="/settings/holidays" element={<RouteGuard superAdmin denyMessage="Holidays are restricted to Super Admin."><HolidaysSettings /></RouteGuard>} />
            <Route path="/settings/payroll" element={<SuperAdminRoute label="Payroll Settings"><PayrollSettingsPage /></SuperAdminRoute>} />

            {/* Vendor Orders module */}
            <Route path="/vendor-orders" element={<ProtectedRoute><VendorOrdersList /></ProtectedRoute>} />
            <Route path="/vendor-orders/new" element={<ProtectedRoute><VendorOrderForm /></ProtectedRoute>} />
            <Route path="/vendor-orders/:id" element={<ProtectedRoute><VendorOrderDetail /></ProtectedRoute>} />

            {/* Returns module */}
            <Route path="/returns" element={<ProtectedRoute><ReturnsList /></ProtectedRoute>} />
            <Route path="/returns/new" element={<ProtectedRoute><ReturnNew /></ProtectedRoute>} />
            <Route path="/returns/:id" element={<ProtectedRoute><ReturnDetail /></ProtectedRoute>} />

            {/* Credit Notes module */}
            <Route path="/credit-notes" element={<ProtectedRoute><CreditNotesList /></ProtectedRoute>} />
            <Route path="/credit-notes/:id" element={<ProtectedRoute><CreditNoteDetail /></ProtectedRoute>} />

            {/* Refunds module */}
            <Route path="/refunds" element={<ProtectedRoute><RefundsList /></ProtectedRoute>} />
            <Route path="/refunds/:id" element={<ProtectedRoute><RefundDetail /></ProtectedRoute>} />

            {/* Universal Print routes */}
            <Route path="/print/:documentType/:documentId" element={<ProtectedRoute><PrintRoute /></ProtectedRoute>} />

            {/* Dashboards module */}
            <Route path="/dashboards" element={<ProtectedRoute><DashboardsHome /></ProtectedRoute>} />
            <Route path="/dashboards/admin" element={<ProtectedRoute><SuperAdminDashboard /></ProtectedRoute>} />
            <Route path="/admin/data-health" element={<RouteGuard adminOrSuper denyMessage="Data Health requires Admin access."><DataHealth /></RouteGuard>} />
            <Route path="/dashboards/sales-manager" element={<ProtectedRoute><SalesManagerDashboard /></ProtectedRoute>} />
            <Route path="/dashboards/sales-rep" element={<ProtectedRoute><SalesRepDashboard /></ProtectedRoute>} />
            <Route path="/dashboards/warehouse" element={<ProtectedRoute><WarehouseDashboard /></ProtectedRoute>} />
            <Route path="/dashboards/accountant" element={<ProtectedRoute><AccountantDashboard /></ProtectedRoute>} />
            <Route path="/dashboards/hr" element={<ProtectedRoute><HRDashboard /></ProtectedRoute>} />
            <Route path="/dashboards/me" element={<ProtectedRoute><EmployeeDashboard /></ProtectedRoute>} />
            <Route path="/dashboards/crm" element={<ProtectedRoute><CRMOverview /></ProtectedRoute>} />
            <Route path="/discuss" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />

            {/* Chat module */}
            <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
            <Route path="/chat/mentions" element={<ProtectedRoute><MentionsPage /></ProtectedRoute>} />
            <Route path="/chat/search" element={<ProtectedRoute><ChatSearchPage /></ProtectedRoute>} />
            <Route path="/chat/notifications" element={<ProtectedRoute><ChatNotificationsPage /></ProtectedRoute>} />
            <Route path="/chat/channels/:id" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
            <Route path="/chat/dms/:userId" element={<ProtectedRoute><ChatDMRedirect /></ProtectedRoute>} />

            {/* HR / Employees module */}
            <Route path="/employees" element={<ProtectedRoute><EmployeesOverview /></ProtectedRoute>} />
            <Route path="/employees/directory" element={<ProtectedRoute><EmployeesDirectory /></ProtectedRoute>} />
            <Route path="/employees/org-chart" element={<ProtectedRoute><OrgChartPage /></ProtectedRoute>} />
            <Route path="/calendar" element={<ProtectedRoute><UnifiedCalendarPage /></ProtectedRoute>} />
            <Route path="/employees/new" element={<ProtectedRoute><EmployeeForm /></ProtectedRoute>} />
            <Route path="/employees/departments" element={<ProtectedRoute><DepartmentsList /></ProtectedRoute>} />
            <Route path="/employees/departments/:id" element={<ProtectedRoute><DepartmentDetail /></ProtectedRoute>} />
            <Route path="/employees/contracts" element={<ProtectedRoute><ContractsList /></ProtectedRoute>} />
            <Route path="/employees/contracts/new" element={<ProtectedRoute><ContractForm /></ProtectedRoute>} />
            <Route path="/employees/contracts/:id" element={<ProtectedRoute><ContractDetail /></ProtectedRoute>} />
            <Route path="/employees/:id" element={<ProtectedRoute><EmployeeDetail /></ProtectedRoute>} />
            <Route path="/employees/:id/edit" element={<ProtectedRoute><EmployeeForm /></ProtectedRoute>} />

            {/* Attendance module (HR Batch 2) */}
            <Route path="/attendance/clock-in" element={<ProtectedRoute><ClockIn /></ProtectedRoute>} />
            <Route path="/attendance/my" element={<ProtectedRoute><MyAttendance /></ProtectedRoute>} />
            <Route path="/attendance/team" element={<ProtectedRoute><TeamAttendance /></ProtectedRoute>} />
            <Route path="/attendance/admin" element={<RouteGuard requiredRoles={["admin","super_admin","hr_manager"]} denyMessage="Attendance admin requires Admin or HR."><AdminAttendance /></RouteGuard>} />
            <Route path="/attendance/admin/import" element={<RouteGuard requiredRoles={["admin","super_admin","hr_manager"]} denyMessage="Attendance admin requires Admin or HR."><AdminImport /></RouteGuard>} />
            <Route path="/attendance/locations" element={<ProtectedRoute><LocationsPage /></ProtectedRoute>} />
            <Route path="/attendance/holidays" element={<ProtectedRoute><HolidaysPage /></ProtectedRoute>} />
            <Route path="/attendance/work-schedules" element={<ProtectedRoute><WorkSchedulesPage /></ProtectedRoute>} />
            <Route path="/attendance/roster" element={<ProtectedRoute><RosterPlanning /></ProtectedRoute>} />
            <Route path="/attendance/roster/reschedule" element={<ProtectedRoute><RosterReschedule /></ProtectedRoute>} />

            {/* Leave routes (HR Batch 3) */}
            <Route path="/leave/my-leaves" element={<ProtectedRoute><MyLeaves /></ProtectedRoute>} />
            <Route path="/leave/apply" element={<ProtectedRoute><ApplyLeave /></ProtectedRoute>} />
            <Route path="/leave/team" element={<ProtectedRoute><TeamLeaves /></ProtectedRoute>} />
            <Route path="/leave/calendar" element={<ProtectedRoute><LeaveCalendar /></ProtectedRoute>} />
            <Route path="/leave/admin/requests" element={<RouteGuard superAdmin denyMessage="Leave admin is restricted to Super Admin."><AdminRequests /></RouteGuard>} />
            <Route path="/leave/admin/approvals" element={<RouteGuard superAdmin denyMessage="Leave admin is restricted to Super Admin."><AdminApprovals /></RouteGuard>} />
            <Route path="/leave/admin/balances" element={<RouteGuard superAdmin denyMessage="Leave admin is restricted to Super Admin."><AdminBalances /></RouteGuard>} />
            <Route path="/leave/admin/entitlements" element={<RouteGuard superAdmin denyMessage="Leave admin is restricted to Super Admin."><AdminEntitlements /></RouteGuard>} />
            <Route path="/leave/admin/types" element={<RouteGuard superAdmin denyMessage="Leave admin is restricted to Super Admin."><AdminLeaveTypes /></RouteGuard>} />
            <Route path="/leave/admin/comp-off" element={<RouteGuard superAdmin denyMessage="Leave admin is restricted to Super Admin."><AdminCompOff /></RouteGuard>} />
            <Route path="/leave/:id" element={<ProtectedRoute><LeaveDetail /></ProtectedRoute>} />

            {/* Work schedule (Phase 7 Batch 2) */}
            <Route path="/work-schedule" element={<ProtectedRoute><WorkSchedulePage /></ProtectedRoute>} />
            <Route path="/work-schedule/admin" element={<ProtectedRoute><AdminWorkSchedule /></ProtectedRoute>} />

            {/* Payroll routes (HR Batch 4) */}
            <Route path="/payroll" element={<SuperAdminRoute label="Payroll"><PayrollDashboard /></SuperAdminRoute>} />
            <Route path="/payroll/periods" element={<SuperAdminRoute label="Payroll"><PayrollPeriodsList /></SuperAdminRoute>} />
            <Route path="/payroll/periods/:id" element={<SuperAdminRoute label="Payroll"><PayrollPeriodDetail /></SuperAdminRoute>} />
            <Route path="/payroll/payslips/:id" element={<SuperAdminRoute label="Payroll"><PayslipDetail /></SuperAdminRoute>} />
            <Route path="/payroll/my-payslips" element={<SuperAdminRoute label="Payroll"><MyPayslips /></SuperAdminRoute>} />
            <Route path="/payroll/admin/components" element={<SuperAdminRoute label="Payroll"><AdminComponents /></SuperAdminRoute>} />
            <Route path="/payroll/admin/settings" element={<SuperAdminRoute label="Payroll"><AdminPayrollSettings /></SuperAdminRoute>} />
            <Route path="/payroll/admin/loans" element={<SuperAdminRoute label="Payroll"><AdminLoans /></SuperAdminRoute>} />
            <Route path="/payroll/admin/advances" element={<SuperAdminRoute label="Payroll"><AdminAdvances /></SuperAdminRoute>} />

            {/* Appraisals routes (HR Batch 5) */}
            <Route path="/appraisals" element={<SuperAdminRoute label="Appraisals"><AppraisalsOverview /></SuperAdminRoute>} />
            <Route path="/appraisals/my-appraisals" element={<SuperAdminRoute label="Appraisals"><MyAppraisals /></SuperAdminRoute>} />
            <Route path="/appraisals/team" element={<SuperAdminRoute label="Appraisals"><TeamAppraisals /></SuperAdminRoute>} />
            <Route path="/appraisals/admin/cycles" element={<SuperAdminRoute label="Appraisals"><AdminCycles /></SuperAdminRoute>} />
            <Route path="/appraisals/admin/cycles/:id" element={<SuperAdminRoute label="Appraisals"><AdminCycleDetail /></SuperAdminRoute>} />
            <Route path="/appraisals/admin/templates" element={<SuperAdminRoute label="Appraisals"><AdminAppraisalTemplates /></SuperAdminRoute>} />
            <Route path="/appraisals/admin/reports" element={<SuperAdminRoute label="Appraisals"><AdminAppraisalReports /></SuperAdminRoute>} />
            <Route path="/appraisals/:id/self-review" element={<SuperAdminRoute label="Appraisals"><AppraisalSelfReview /></SuperAdminRoute>} />
            <Route path="/appraisals/:id/manager-review" element={<SuperAdminRoute label="Appraisals"><AppraisalManagerReview /></SuperAdminRoute>} />
            <Route path="/appraisals/:id/hr-review" element={<SuperAdminRoute label="Appraisals"><AppraisalHRReview /></SuperAdminRoute>} />
            <Route path="/appraisals/:id" element={<SuperAdminRoute label="Appraisals"><AppraisalDetail /></SuperAdminRoute>} />

            {/* CRM module */}
            <Route path="/crm" element={<ProtectedRoute><LeadsPage /></ProtectedRoute>} />
            <Route path="/crm/pipeline" element={<ProtectedRoute><CRMPipeline /></ProtectedRoute>} />
            <Route path="/crm/opportunities/new" element={<ProtectedRoute><OpportunityForm /></ProtectedRoute>} />
            <Route path="/crm/opportunities/:id" element={<ProtectedRoute><OpportunityDetail /></ProtectedRoute>} />
            <Route path="/crm/contacts" element={<ProtectedRoute><CRMContactsList /></ProtectedRoute>} />
            <Route path="/crm/contacts/new" element={<ProtectedRoute><ContactForm /></ProtectedRoute>} />
            <Route path="/crm/contacts/:id" element={<ProtectedRoute><CRMContactDetail /></ProtectedRoute>} />
            <Route path="/crm/contacts/:id/edit" element={<ProtectedRoute><ContactForm /></ProtectedRoute>} />
            <Route path="/crm/leads" element={<Navigate to="/crm" replace />} />

            {/* Manufacturing module */}
            <Route path="/manufacturing" element={<ProtectedRoute><ManufacturingOverview /></ProtectedRoute>} />
            <Route path="/manufacturing/work-orders" element={<ProtectedRoute><WorkOrdersList /></ProtectedRoute>} />
            <Route path="/manufacturing/work-orders/new" element={<ProtectedRoute><WorkOrderForm /></ProtectedRoute>} />
            <Route path="/manufacturing/work-orders/:id/edit" element={<ProtectedRoute><WorkOrderForm /></ProtectedRoute>} />
            <Route path="/manufacturing/work-orders/:id" element={<ProtectedRoute><WorkOrderDetail /></ProtectedRoute>} />
            <Route path="/shop-floor" element={<RouteGuard requiredRoles={["factory_incharge","admin","super_admin"]} denyMessage="Shop Floor requires Factory Incharge or Admin."><ShopFloorHome /></RouteGuard>} />
            <Route path="/shop-floor/work-orders/:id" element={<RouteGuard requiredRoles={["factory_incharge","admin","super_admin"]} denyMessage="Shop Floor requires Factory Incharge or Admin."><ShopFloorWorkOrderDetail /></RouteGuard>} />
            <Route path="/shop-floor/factory-inventory" element={<RouteGuard requiredRoles={["factory_incharge","admin","super_admin"]} denyMessage="Shop Floor requires Factory Incharge or Admin."><FactoryInventoryPage /></RouteGuard>} />

            {/* Invoices module */}
            <Route path="/invoicing" element={<ProtectedRoute><BillsList /></ProtectedRoute>} />
            <Route path="/invoicing/bills" element={<ProtectedRoute><BillsList /></ProtectedRoute>} />
            <Route path="/invoicing/warranty-bills" element={<ProtectedRoute><WarrantyBillsList /></ProtectedRoute>} />
            <Route path="/invoicing/factory-bills" element={<ProtectedRoute><FactoryBillsList /></ProtectedRoute>} />
            <Route path="/invoicing/payments" element={<ProtectedRoute><PaymentsList /></ProtectedRoute>} />
            <Route path="/invoicing/new" element={<ProtectedRoute><InvoiceForm /></ProtectedRoute>} />
            <Route path="/invoicing/invoices/:id" element={<ProtectedRoute><InvoiceDetail /></ProtectedRoute>} />
            <Route path="/invoicing/reports" element={<ProtectedRoute><InvoicingReportsLanding /></ProtectedRoute>} />
            <Route path="/invoicing/reports/:reportKey" element={<ProtectedRoute><ReportPage /></ProtectedRoute>} />
            <Route path="/invoicing/*" element={<ProtectedRoute><InvoicesList /></ProtectedRoute>} />

            {/* Reports module */}
            <Route path="/reports" element={<ProtectedRoute><ReportsHub /></ProtectedRoute>} />
            <Route path="/inventory/reports" element={<ProtectedRoute><InventoryReportsLanding /></ProtectedRoute>} />
            <Route path="/inventory/reports/:reportKey" element={<ProtectedRoute><ReportPage /></ProtectedRoute>} />
            <Route path="/manufacturing/reports" element={<ProtectedRoute><ManufacturingReportsLanding /></ProtectedRoute>} />
            <Route path="/manufacturing/reports/:reportKey" element={<ProtectedRoute><ReportPage /></ProtectedRoute>} />
            <Route path="/employees/reports" element={<ProtectedRoute><EmployeesReportsLanding /></ProtectedRoute>} />
            <Route path="/employees/reports/:reportKey" element={<ProtectedRoute><ReportPage /></ProtectedRoute>} />
            <Route path="/attendance/reports" element={<ProtectedRoute><AttendanceReportsLanding /></ProtectedRoute>} />
            <Route path="/attendance/reports/:reportKey" element={<ProtectedRoute><ReportPage /></ProtectedRoute>} />
            <Route path="/leave/reports" element={<ProtectedRoute><LeaveReportsLanding /></ProtectedRoute>} />
            <Route path="/leave/reports/:reportKey" element={<ProtectedRoute><ReportPage /></ProtectedRoute>} />
            <Route path="/payroll/reports" element={<SuperAdminRoute label="Payroll"><PayrollReportsLanding /></SuperAdminRoute>} />
            <Route path="/payroll/reports/:reportKey" element={<SuperAdminRoute label="Payroll"><ReportPage /></SuperAdminRoute>} />
            <Route path="/appraisals/reports" element={<SuperAdminRoute label="Appraisals"><AppraisalsReportsLanding /></SuperAdminRoute>} />
            <Route path="/appraisals/reports/:reportKey" element={<SuperAdminRoute label="Appraisals"><ReportPage /></SuperAdminRoute>} />
            <Route path="/crm/reports" element={<ProtectedRoute><CRMReportsLanding /></ProtectedRoute>} />
            <Route path="/crm/reports/:reportKey" element={<ProtectedRoute><ReportPage /></ProtectedRoute>} />

            {/* Catch-all */}
            <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
            <Route path="/settings/notifications" element={<ProtectedRoute><NotificationSettings /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </ErrorBoundary>
        </BrowserRouter>
        </TooltipProvider>
      </AccessibilityProvider>
    </CustomizationProvider>
  </AuthProvider>
</QueryClientProvider>
);

export default App;
