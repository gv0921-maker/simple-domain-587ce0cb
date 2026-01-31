import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  Target,
  ShoppingCart,
  ArrowRight,
  Calendar,
  Phone,
  Mail,
  CheckCircle2,
} from 'lucide-react';
import {
  getLeads,
  getOpportunities,
  getSalesOrders,
  getContacts,
  type Lead,
  type Opportunity,
} from '@/lib/data/sales';
import { SALES_NAV } from '@/lib/navigation/sales';
import { SimpleBarChart } from '@/components/dashboard/SimpleBarChart';
import { format, parseISO, isThisMonth, isThisWeek } from 'date-fns';
import { cn } from '@/lib/utils';

export default function SalesOverview() {
  const navigate = useNavigate();
  const [leads] = useState(() => getLeads());
  const [opportunities] = useState(() => getOpportunities());
  const [orders] = useState(() => getSalesOrders());
  const [contacts] = useState(() => getContacts());

  const stats = useMemo(() => {
    const totalPipeline = opportunities
      .filter((o) => !o.stage.startsWith('closed'))
      .reduce((sum, o) => sum + o.expectedRevenue, 0);

    const wonRevenue = opportunities
      .filter((o) => o.stage === 'closed_won')
      .reduce((sum, o) => sum + o.expectedRevenue, 0);

    const monthlyOrders = orders.filter((o) =>
      isThisMonth(parseISO(o.orderDate))
    );

    const monthlyRevenue = monthlyOrders.reduce((sum, o) => sum + o.total, 0);

    const conversionRate =
      leads.length > 0
        ? Math.round(
            (leads.filter((l) => l.status === 'won').length / leads.length) * 100
          )
        : 0;

    return {
      totalPipeline,
      wonRevenue,
      monthlyRevenue,
      monthlyOrderCount: monthlyOrders.length,
      activeLeads: leads.filter((l) => !['won', 'lost'].includes(l.status)).length,
      totalCustomers: contacts.length,
      conversionRate,
    };
  }, [leads, opportunities, orders, contacts]);

  const pipelineData = useMemo(() => {
    const stages = [
      { status: 'new', color: 'blue' as const },
      { status: 'qualified', color: 'teal' as const },
      { status: 'proposition', color: 'orange' as const },
      { status: 'won', color: 'coral' as const },
    ];
    return stages.map((stage) => ({
      value: leads.filter((l) => l.status === stage.status).length,
      color: stage.color,
    }));
  }, [leads]);

  const recentActivities = useMemo(() => {
    const activities: { type: string; text: string; time: string; icon: any }[] = [];

    leads.slice(0, 3).forEach((lead) => {
      if (lead.activities.length > 0) {
        const latest = lead.activities[lead.activities.length - 1];
        activities.push({
          type: latest.type,
          text: `${latest.subject} - ${lead.name}`,
          time: format(parseISO(latest.timestamp), 'MMM d, HH:mm'),
          icon: latest.type === 'call' ? Phone : latest.type === 'email' ? Mail : CheckCircle2,
        });
      }
    });

    return activities;
  }, [leads]);

  const upcomingDeals = useMemo(() => {
    return opportunities
      .filter((o) => !o.stage.startsWith('closed'))
      .sort((a, b) => new Date(a.expectedCloseDate).getTime() - new Date(b.expectedCloseDate).getTime())
      .slice(0, 5);
  }, [opportunities]);

  return (
    <AppLayout title="CRM" moduleNav={SALES_NAV}>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Sales Overview</h1>
            <p className="text-muted-foreground">Track your sales performance and pipeline</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/sales/leads/new')}>
              Add Lead
            </Button>
            <Button onClick={() => navigate('/sales/orders/new')}>
              New Order
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="animate-slide-up" style={{ animationDelay: '0ms' }}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Pipeline Value
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-success" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${stats.totalPipeline.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {opportunities.filter((o) => !o.stage.startsWith('closed')).length} active deals
              </p>
            </CardContent>
          </Card>

          <Card className="animate-slide-up" style={{ animationDelay: '50ms' }}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Monthly Revenue
              </CardTitle>
              <DollarSign className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${stats.monthlyRevenue.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats.monthlyOrderCount} orders this month
              </p>
            </CardContent>
          </Card>

          <Card className="animate-slide-up" style={{ animationDelay: '100ms' }}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Active Leads
              </CardTitle>
              <Target className="h-4 w-4 text-warning" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.activeLeads}</div>
              <div className="flex items-center gap-2 mt-1">
                <Progress value={stats.conversionRate} className="h-1.5 flex-1" />
                <span className="text-xs text-muted-foreground">{stats.conversionRate}% won</span>
              </div>
            </CardContent>
          </Card>

          <Card className="animate-slide-up" style={{ animationDelay: '150ms' }}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Customers
              </CardTitle>
              <Users className="h-4 w-4 text-info" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalCustomers}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Across all accounts
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Pipeline Chart */}
          <Card className="lg:col-span-2 animate-fade-in">
            <CardHeader>
              <CardTitle>Lead Pipeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex justify-center gap-4 mb-4">
                {['New', 'Qualified', 'Proposition', 'Won'].map((label, i) => (
                  <div key={label} className="flex items-center gap-1 text-xs text-muted-foreground">
                    <div className={cn('w-2 h-2 rounded-full', 
                      i === 0 ? 'bg-chart-blue' : 
                      i === 1 ? 'bg-chart-teal' : 
                      i === 2 ? 'bg-chart-orange' : 'bg-chart-coral'
                    )} />
                    {label}
                  </div>
                ))}
              </div>
              <SimpleBarChart data={pipelineData} height={200} />
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card className="animate-fade-in">
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => navigate('/sales/pipeline')}
              >
                <Target className="h-4 w-4" />
                View Pipeline
                <ArrowRight className="h-4 w-4 ml-auto" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => navigate('/sales/leads/new')}
              >
                <Users className="h-4 w-4" />
                Create Lead
                <ArrowRight className="h-4 w-4 ml-auto" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => navigate('/sales/quotations/new')}
              >
                <ShoppingCart className="h-4 w-4" />
                New Quotation
                <ArrowRight className="h-4 w-4 ml-auto" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={() => navigate('/sales/customers')}
              >
                <Users className="h-4 w-4" />
                Manage Customers
                <ArrowRight className="h-4 w-4 ml-auto" />
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upcoming Deals */}
          <Card className="animate-fade-in">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Upcoming Deals</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate('/sales/opportunities')}>
                View All
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {upcomingDeals.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No upcoming deals
                  </p>
                ) : (
                  upcomingDeals.map((deal) => (
                    <div
                      key={deal.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors"
                      onClick={() => navigate(`/sales/opportunities/${deal.id}`)}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{deal.name}</p>
                        <p className="text-xs text-muted-foreground">{deal.company}</p>
                      </div>
                      <div className="text-right ml-4">
                        <p className="font-semibold text-sm">
                          ${deal.expectedRevenue.toLocaleString()}
                        </p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {format(parseISO(deal.expectedCloseDate), 'MMM d')}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card className="animate-fade-in">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Recent Activity</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => navigate('/sales/leads')}>
                View All
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {recentActivities.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No recent activities
                  </p>
                ) : (
                  recentActivities.map((activity, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-3 p-3 rounded-lg bg-muted/50"
                    >
                      <div className="p-2 rounded-lg bg-primary/10">
                        <activity.icon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{activity.text}</p>
                        <p className="text-xs text-muted-foreground">{activity.time}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
