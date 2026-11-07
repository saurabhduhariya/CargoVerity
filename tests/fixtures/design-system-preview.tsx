"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FeedbackState } from "@/components/ui/feedback-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Typography } from "@/components/ui/typography";

/** Browser QA fixture only. Never mounted on an application route; makes no API requests. */
export function DesignSystemPreview() {
  const [submitCount, setSubmitCount] = useState(0);
  const [lastAction, setLastAction] = useState("No preview action yet.");
  const [activeTab, setActiveTab] = useState("fields");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [confirmCount, setConfirmCount] = useState(0);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <Typography variant="page-title">CargoVerity design-system foundation</Typography>
        <Typography className="text-foreground-secondary">Isolated component checks. All values are synthetic; no API or authentication requests.</Typography>
      </header>

      <Card>
        <CardHeader><CardTitle>Actions and status</CardTitle><CardDescription>States communicate review work, not claims of customs clearance.</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => setLastAction("Primary action activated.")}>Save field</Button>
            <Button type="button" variant="outline" onClick={() => setLastAction("Outline action activated.")}>Run checks</Button>
            <Button type="button" variant="ghost" onClick={() => setLastAction("Ghost action activated.")}>Next review item</Button>
            <Button type="button" variant="destructive" onClick={() => setDialogOpen(true)}>Replace document</Button>
            <Button type="button" disabled>Submit disabled</Button>
            <Button type="button" loading>Saving field</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" onClick={() => setLastAction("Compact action activated.")}>Compact action</Button>
            <Button type="button" size="lg" variant="outline">Large action</Button>
            <Button type="button" size="icon" variant="outline" aria-label="Add preview item"><Plus aria-hidden="true" className="size-4" /></Button>
            <Button type="button" variant="link" onClick={() => setLastAction("Link action activated.")}>View preview history</Button>
          </div>
          <div className="flex flex-wrap gap-3">
            <StatusBadge status="DRAFT" />
            <StatusBadge status="REQUIRES_REVIEW" />
            <StatusBadge status="MISMATCH" />
            <StatusBadge status="PASS" />
            <StatusBadge status="PENDING_MANAGER_APPROVAL" />
            <StatusBadge status="HUMAN_CLEARED" />
            <Badge variant="info">Model estimate · 72%</Badge>
          </div>
          <Typography variant="caption" data-testid="last-action">{lastAction}</Typography>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Native form controls</CardTitle><CardDescription>Values, constraints, labels, and submission behavior remain native.</CardDescription></CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); setSubmitCount((count) => count + 1); }}>
              <div className="space-y-2">
                <Label htmlFor="preview-reference">Shipment reference</Label>
                <Input id="preview-reference" name="reference" defaultValue="SHP-24811" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="preview-amount">Invoice total</Label>
                <div className="flex items-center gap-3">
                  <Input id="preview-amount" name="amount" defaultValue="16320.00" inputMode="decimal" className="font-mono tabular-nums" />
                  <Typography variant="data">USD</Typography>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="preview-type">Document type</Label>
                <Select id="preview-type" name="documentType" defaultValue="INVOICE">
                  <option value="INVOICE">Commercial invoice</option>
                  <option value="PACKING_LIST">Packing list</option>
                  <option value="BILL_OF_LADING">Bill of lading</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="preview-reason">Correction reason</Label>
                <Textarea id="preview-reason" name="reason" defaultValue="Verified the stated value against the synthetic source document." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="preview-invalid">Invalid amount example</Label>
                <Input id="preview-invalid" aria-invalid="true" aria-describedby="preview-invalid-error" defaultValue="Not a decimal" />
                <p id="preview-invalid-error" className="text-sm text-danger">Enter a valid decimal amount.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="preview-revision">Read-only revision</Label>
                  <Input id="preview-revision" defaultValue="4" readOnly />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="preview-disabled">Disabled control</Label>
                  <Input id="preview-disabled" defaultValue="Unavailable in this example" disabled />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="preview-placeholder">Optional reference</Label>
                <Input id="preview-placeholder" placeholder="e.g. SHP-24811" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="preview-override">Legacy style override</Label>
                <Input id="preview-override" defaultValue="Existing compact control" className="h-8 bg-warning-surface text-xs" />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button>Check native submission</Button>
                <Typography variant="caption" data-testid="submit-count">Submissions: {submitCount}</Typography>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Panels and feedback</CardTitle><CardDescription>Keyboard tabs retain drafts. Feedback provides meaningful status text.</CardDescription></CardHeader>
          <CardContent className="space-y-6">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList aria-label="Preview review panels">
                <TabsTrigger value="document">Document</TabsTrigger>
                <TabsTrigger value="fields">Fields</TabsTrigger>
                <TabsTrigger value="disabled" disabled>Disabled</TabsTrigger>
                <TabsTrigger value="checks">Checks</TabsTrigger>
              </TabsList>
              <TabsContent value="document"><Typography>Commercial invoice · synthetic page 1</Typography></TabsContent>
              <TabsContent value="fields">
                <div className="space-y-2">
                  <Label htmlFor="preview-tab-draft">Retained draft</Label>
                  <Input id="preview-tab-draft" defaultValue="Draft value" />
                </div>
              </TabsContent>
              <TabsContent value="disabled"><Typography>Disabled panel</Typography></TabsContent>
              <TabsContent value="checks"><StatusBadge status="MISMATCH" /><Typography className="mt-3">Synthetic gross weights differ by 45 kg.</Typography></TabsContent>
            </Tabs>

            <Tabs defaultValue="a" activationMode="manual" dir="rtl">
              <TabsList aria-label="Manual RTL tabs"><TabsTrigger value="a">A</TabsTrigger><TabsTrigger value="b">B</TabsTrigger></TabsList>
              <TabsContent value="a"><Typography>Manual activation · A</Typography></TabsContent>
              <TabsContent value="b"><Typography>Manual activation · B</Typography></TabsContent>
            </Tabs>

            <Tabs defaultValue="one" orientation="vertical" loop={false}>
              <TabsList aria-label="Vertical tabs"><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList>
              <TabsContent value="one"><Typography>Vertical panel one</Typography></TabsContent>
              <TabsContent value="two"><Typography>Vertical panel two</Typography></TabsContent>
            </Tabs>

            <FeedbackState kind="error" headingLevel={3} title="Evidence unavailable" description="Example error state. No document requests are made by this preview." action={<Button type="button" variant="outline" onClick={() => setLastAction("Retry preview activated.")}>Retry preview</Button>} />
            <FeedbackState kind="loading" headingLevel={3} title="Loading preview" description="Loading feedback remains readable with reduced motion." className="py-0" />
            <div className="space-y-2" aria-label="Skeleton example"><Skeleton className="h-4 w-40" /><Skeleton className="h-4 w-56 max-w-full" /></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Comparison table</CardTitle><CardDescription>Readable rows, explicit states, and decimal strings preserved as supplied.</CardDescription></CardHeader>
        <CardContent className="p-0">
          <Table className="min-w-[36rem]" containerLabel="Synthetic comparison table">
            <TableCaption className="m-0 px-4 py-3">Synthetic component fixture — not for customs filing.</TableCaption>
            <TableHeader><TableRow><TableHead>Shipment</TableHead><TableHead>Document</TableHead><TableHead numeric>Gross weight (kg)</TableHead><TableHead>Review state</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow><TableCell className="font-mono">SHP-24811</TableCell><TableCell>Commercial invoice</TableCell><TableCell numeric>3120.000</TableCell><TableCell><StatusBadge status="REQUIRES_REVIEW" /></TableCell></TableRow>
              <TableRow aria-selected="true"><TableCell className="font-mono">SHP-24811</TableCell><TableCell>Packing list</TableCell><TableCell numeric>3165.000</TableCell><TableCell><StatusBadge status="CORRECTED" /></TableCell></TableRow>
              <TableRow><TableCell className="font-mono">SHP-24811</TableCell><TableCell>Bill of lading</TableCell><TableCell numeric>3165.000</TableCell><TableCell><StatusBadge status="CONFIRMED" /></TableCell></TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        <FeedbackState kind="empty" title="No supporting documents" description="Add an invoice, packing list, or bill of lading to begin review." />
        <FeedbackState kind="success" title="Preview saved" description="Synthetic confirmation feedback; no application records changed." />
        <FeedbackState kind="info" title="Model estimate" description="Confidence describes a model estimate, not calibrated accuracy." />
      </div>

      <ConfirmDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setDialogBusy(false); }}
        onConfirm={() => { setConfirmCount((count) => count + 1); setDialogOpen(false); }}
        title="Replace document?"
        description="Component test only. No file, shipment, revision, or approval will be changed."
        confirmLabel="Confirm preview"
        variant="destructive"
        busy={dialogBusy}
      >
        <Button type="button" variant="ghost" onClick={() => setDialogBusy((busy) => !busy)}>Toggle busy preview</Button>
      </ConfirmDialog>
      <Typography variant="caption" data-testid="confirm-count">Confirmation callbacks: {confirmCount}</Typography>
    </main>
  );
}
