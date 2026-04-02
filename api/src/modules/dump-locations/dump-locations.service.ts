import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { DumpLocation, DumpLocationRate, DumpLocationSurcharge } from './entities/dump-location.entity';
import { DumpTicket } from './entities/dump-ticket.entity';
import { Job } from '../jobs/entities/job.entity';
import { PricingRule } from '../pricing/entities/pricing-rule.entity';
import { AutomationLog } from '../automation/entities/automation-log.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { InvoiceLineItem } from '../billing/entities/invoice-line-item.entity';
import { JobCost } from '../billing/entities/job-cost.entity';

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

@Injectable()
export class DumpLocationsService {
  constructor(
    @InjectRepository(DumpLocation) private readonly locRepo: Repository<DumpLocation>,
    @InjectRepository(DumpLocationRate) private readonly rateRepo: Repository<DumpLocationRate>,
    @InjectRepository(DumpLocationSurcharge) private readonly surRepo: Repository<DumpLocationSurcharge>,
    @InjectRepository(Job) private readonly jobRepo: Repository<Job>,
    @InjectRepository(PricingRule) private readonly pricingRepo: Repository<PricingRule>,
    @InjectRepository(AutomationLog) private readonly logRepo: Repository<AutomationLog>,
    @InjectRepository(DumpTicket) private readonly ticketRepo: Repository<DumpTicket>,
    @InjectRepository(Invoice) private readonly invoiceRepo: Repository<Invoice>,
    @InjectRepository(InvoiceLineItem) private readonly lineItemRepo: Repository<InvoiceLineItem>,
    @InjectRepository(JobCost) private readonly jobCostRepo: Repository<JobCost>,
    private readonly dataSource: DataSource,
  ) {}

  /* ───── Dump Locations CRUD ───── */

  async findAll(tenantId: string) {
    const locations = await this.locRepo.find({
      where: { tenant_id: tenantId, is_active: true },
      relations: ['rates', 'surcharges'],
      order: { name: 'ASC' },
    });
    const today = new Date().toISOString().split('T')[0];
    for (const loc of locations) {
      loc.rates = (loc.rates || []).filter(r => r.is_active && (!r.effective_until || r.effective_until >= today));
      loc.surcharges = (loc.surcharges || []).filter(s => s.is_active && (!s.effective_until || s.effective_until >= today));
    }
    return locations;
  }

  async findOne(tenantId: string, id: string) {
    const loc = await this.locRepo.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['rates', 'surcharges'],
    });
    if (!loc) throw new NotFoundException('Dump location not found');
    const today = new Date().toISOString().split('T')[0];
    loc.rates = (loc.rates || []).filter(r => r.is_active && (!r.effective_until || r.effective_until >= today));
    loc.surcharges = (loc.surcharges || []).filter(s => s.is_active && (!s.effective_until || s.effective_until >= today));
    return loc;
  }

  async create(tenantId: string, body: Record<string, unknown>) {
    const loc = this.locRepo.create({
      tenant_id: tenantId,
      name: body.name as string,
      address: body.address as string,
      city: (body.city as string) || undefined,
      state: (body.state as string) || undefined,
      zip: (body.zip as string) || undefined,
      latitude: body.latitude != null ? Number(body.latitude) : undefined,
      longitude: body.longitude != null ? Number(body.longitude) : undefined,
      phone: (body.phone as string) || undefined,
      contact_name: (body.contactName || body.contact_name) as string || undefined,
      notes: (body.notes as string) || undefined,
      operating_hours: (body.operatingHours || body.operating_hours) as string || undefined,
    } as Partial<DumpLocation>);
    return this.locRepo.save(loc);
  }

  async update(tenantId: string, id: string, body: Record<string, unknown>) {
    const loc = await this.findOne(tenantId, id);
    Object.assign(loc, body);
    return this.locRepo.save(loc);
  }

  async remove(tenantId: string, id: string) {
    const loc = await this.findOne(tenantId, id);
    loc.is_active = false;
    return this.locRepo.save(loc);
  }

  /* ───── Rates ───── */

  async getRates(tenantId: string, locationId: string) {
    await this.findOne(tenantId, locationId);
    const today = new Date().toISOString().split('T')[0];
    const rates = await this.rateRepo.find({ where: { dump_location_id: locationId, is_active: true } });
    return rates.filter(r => !r.effective_until || r.effective_until >= today);
  }

  async addRate(tenantId: string, locationId: string, body: Record<string, unknown>) {
    await this.findOne(tenantId, locationId);
    const today = new Date().toISOString().split('T')[0];
    const rate = this.rateRepo.create({
      dump_location_id: locationId,
      waste_type: (body.wasteType || body.waste_type) as string,
      waste_type_label: (body.wasteTypeLabel || body.waste_type_label) as string,
      rate_per_ton: Number(body.ratePerTon ?? body.rate_per_ton ?? 0),
      minimum_charge: body.minimumCharge != null ? Number(body.minimumCharge) : body.minimum_charge != null ? Number(body.minimum_charge) : null,
      rate_type: ((body.rateType || body.rate_type) as string) || 'per_ton',
      effective_date: today,
    } as Partial<DumpLocationRate>);
    return this.rateRepo.save(rate);
  }

  async updateRate(rateId: string, body: Record<string, unknown>) {
    const old = await this.rateRepo.findOneBy({ id: rateId });
    if (!old) throw new NotFoundException('Rate not found');
    const today = new Date().toISOString().split('T')[0];

    // Archive old rate
    old.effective_until = today;
    await this.rateRepo.save(old);

    // Create new versioned rate
    const newRate = this.rateRepo.create({
      dump_location_id: old.dump_location_id,
      waste_type: (body.wasteType || body.waste_type || old.waste_type) as string,
      waste_type_label: (body.wasteTypeLabel || body.waste_type_label || old.waste_type_label) as string,
      rate_per_ton: Number(body.ratePerTon ?? body.rate_per_ton ?? old.rate_per_ton),
      minimum_charge: body.minimumCharge != null ? Number(body.minimumCharge) : body.minimum_charge != null ? Number(body.minimum_charge) : old.minimum_charge,
      rate_type: old.rate_type,
      effective_date: today,
    } as Partial<DumpLocationRate>);
    return this.rateRepo.save(newRate);
  }

  async removeRate(rateId: string) {
    const rate = await this.rateRepo.findOneBy({ id: rateId });
    if (!rate) throw new NotFoundException('Rate not found');
    const today = new Date().toISOString().split('T')[0];
    rate.effective_until = today;
    rate.is_active = false;
    return this.rateRepo.save(rate);
  }

  /* ───── Surcharges ───── */

  async getSurcharges(tenantId: string, locationId: string) {
    await this.findOne(tenantId, locationId);
    const today = new Date().toISOString().split('T')[0];
    const surcharges = await this.surRepo.find({
      where: { dump_location_id: locationId, is_active: true },
      order: { sort_order: 'ASC' },
    });
    return surcharges.filter(s => !s.effective_until || s.effective_until >= today);
  }

  async addSurcharge(tenantId: string, locationId: string, body: Record<string, unknown>) {
    await this.findOne(tenantId, locationId);
    const today = new Date().toISOString().split('T')[0];
    const sur = this.surRepo.create({
      dump_location_id: locationId,
      item_type: (body.itemType || body.item_type) as string,
      label: body.label as string,
      dump_charge: Number(body.dumpCharge ?? body.dump_charge ?? 0),
      customer_charge: Number(body.customerCharge ?? body.customer_charge ?? 0),
      charge_type: ((body.chargeType || body.charge_type) as string) || 'flat',
      sort_order: Number(body.sortOrder ?? body.sort_order ?? 0),
      effective_date: today,
    } as Partial<DumpLocationSurcharge>);
    return this.surRepo.save(sur);
  }

  async updateSurcharge(surchargeId: string, body: Record<string, unknown>) {
    const old = await this.surRepo.findOneBy({ id: surchargeId });
    if (!old) throw new NotFoundException('Surcharge not found');
    const today = new Date().toISOString().split('T')[0];

    // Archive old surcharge
    old.effective_until = today;
    await this.surRepo.save(old);

    // Create new versioned surcharge
    const newSur = this.surRepo.create({
      dump_location_id: old.dump_location_id,
      item_type: (body.itemType || body.item_type || old.item_type) as string,
      label: (body.label || old.label) as string,
      dump_charge: Number(body.dumpCharge ?? body.dump_charge ?? old.dump_charge),
      customer_charge: Number(body.customerCharge ?? body.customer_charge ?? old.customer_charge),
      charge_type: old.charge_type,
      sort_order: old.sort_order,
      effective_date: today,
    } as Partial<DumpLocationSurcharge>);
    return this.surRepo.save(newSur);
  }

  async removeSurcharge(surchargeId: string) {
    const sur = await this.surRepo.findOneBy({ id: surchargeId });
    if (!sur) throw new NotFoundException('Surcharge not found');
    const today = new Date().toISOString().split('T')[0];
    sur.effective_until = today;
    sur.is_active = false;
    return this.surRepo.save(sur);
  }

  /* ───── Recommend (haversine) ───── */

  async recommend(tenantId: string, lat: number, lng: number) {
    const locations = await this.locRepo.find({
      where: { tenant_id: tenantId, is_active: true },
      relations: ['rates', 'surcharges'],
    });

    const ranked = locations
      .filter(l => l.latitude && l.longitude)
      .map(l => ({
        ...l,
        distance_miles: Math.round(haversineDistance(lat, lng, Number(l.latitude), Number(l.longitude)) * 10) / 10,
      }))
      .sort((a, b) => a.distance_miles - b.distance_miles);

    return ranked.slice(0, 3);
  }

  /* ───── Dump Slip ───── */

  async submitDumpSlip(tenantId: string, jobId: string, body: Record<string, unknown>, userId: string) {
    const job = await this.jobRepo.findOne({ where: { id: jobId, tenant_id: tenantId }, relations: ['asset'] });
    if (!job) throw new NotFoundException('Job not found');

    // Idempotency: return existing ticket if same job + ticket number
    const ticketNumberCheck = (body.ticketNumber || body.dump_ticket_number || '') as string;
    if (ticketNumberCheck) {
      const existing = await this.ticketRepo.findOne({
        where: { job_id: jobId, ticket_number: ticketNumberCheck },
      });
      if (existing) {
        return { ticket: existing, invoiceId: existing.invoice_id, dumpTotal: Number(existing.total_cost), customerTotal: Number(existing.customer_charges) };
      }
    }

    const dumpLocationId = (body.dumpLocationId || body.dump_location_id) as string;
    const wasteType = (body.wasteType || body.dump_waste_type) as string;
    const weightTons = Number(body.weightTons || body.dump_weight_tons || 0);
    const overageItems = (body.overageItems || body.overage_items || []) as Array<{ type: string; quantity: number }>;
    const ticketNumber = (body.ticketNumber || body.dump_ticket_number || '') as string;
    const ticketPhoto = (body.ticketPhoto || body.dump_ticket_photo || '') as string;

    const location = await this.locRepo.findOne({ where: { id: dumpLocationId }, relations: ['rates', 'surcharges'] });
    if (!location) throw new NotFoundException('Dump location not found');

    const rate = location.rates.find(r => r.waste_type === wasteType && r.is_active);
    const ratePerTon = rate ? Number(rate.rate_per_ton) : 0;
    const minimumCharge = rate ? Number(rate.minimum_charge) || 0 : 0;

    // What the dump charges us
    const dumpTonnageCost = Math.max(weightTons * ratePerTon, minimumCharge);
    const fuelEnvSurchargePerTon = Number(location.fuel_env_surcharge_per_ton) || 0;
    const fuelEnvCost = Math.round(weightTons * fuelEnvSurchargePerTon * 100) / 100;

    // Included tonnage from pricing rule
    const pricingRule = await this.pricingRepo.findOne({
      where: { tenant_id: tenantId, asset_subtype: job.asset?.subtype || undefined, is_active: true },
    });
    const includedTons = pricingRule ? Number(pricingRule.included_tons) || 0 : 0;
    const overageRatePerTon = pricingRule ? Number(pricingRule.overage_per_ton) : 0;
    // Get tenant's customer overage rates
    const tenantRates = await this.jobRepo.query(`SELECT customer_overage_rates FROM tenants WHERE id = $1`, [tenantId]);
    const customerRates = tenantRates?.[0]?.customer_overage_rates || {};
    const perTonRates = (customerRates as any)?.perTon || {};
    const customerRateForType = Number(perTonRates[wasteType]) || overageRatePerTon;

    const overageTons = Math.max(0, weightTons - includedTons);
    const customerTonnageOverage = overageTons * customerRateForType;

    // Surcharge items
    const surchargeItemPrices = (customerRates as any)?.surchargeItems || {};
    let totalDumpOverage = 0;
    let totalCustomerSurcharges = 0;
    const calculatedItems: Array<{ type: string; label: string; quantity: number; chargePerUnit: number; total: number }> = [];

    for (const item of overageItems) {
      const surcharge = location.surcharges.find(s => s.item_type === item.type && s.is_active);
      if (surcharge) {
        const qty = Number(item.quantity) || 0;
        totalDumpOverage += Number(surcharge.dump_charge) * qty;
        const customerPrice = surchargeItemPrices[item.type]?.price || Number(surcharge.customer_charge);
        totalCustomerSurcharges += customerPrice * qty;
        calculatedItems.push({ type: surcharge.item_type, label: surcharge.label, quantity: qty, chargePerUnit: customerPrice, total: customerPrice * qty });
      }
    }

    const dumpTotalCost = dumpTonnageCost + fuelEnvCost + totalDumpOverage;
    const customerCharges = customerTonnageOverage + totalCustomerSurcharges;

    // Create dump ticket
    const ticket = this.ticketRepo.create({
      job_id: jobId, tenant_id: tenantId, dump_location_id: dumpLocationId,
      dump_location_name: location.name, ticket_number: ticketNumber,
      ticket_photo: ticketPhoto, waste_type: wasteType, weight_tons: weightTons,
      base_cost: dumpTonnageCost, overage_items: calculatedItems, overage_charges: totalDumpOverage,
      total_cost: dumpTotalCost, customer_charges: customerCharges,
      dump_tonnage_cost: dumpTonnageCost, fuel_env_cost: fuelEnvCost,
      dump_surcharge_cost: totalDumpOverage,
      customer_tonnage_charge: customerTonnageOverage, customer_surcharge_charge: totalCustomerSurcharges,
      profit_margin: 0, // Profit calculated at rental-chain level, not per-ticket
      submitted_by: userId, submitted_at: new Date(), status: 'submitted',
    });
    let savedTicket: DumpTicket;
    try {
      savedTicket = await this.ticketRepo.save(ticket);
    } catch (error: any) {
      if (error.code === '23505') {
        const existing = await this.ticketRepo.findOne({
          where: { job_id: jobId, ticket_number: ticketNumber },
        });
        if (existing) return { ticket: existing, invoiceId: existing.invoice_id, dumpTotal: Number(existing.total_cost), customerTotal: Number(existing.customer_charges) };
      }
      throw error;
    }

    // Sync to job_costs — one ticket = one cost record
    const jobCostData = {
      tenant_id: tenantId,
      job_id: jobId,
      cost_type: 'dump_fee',
      amount: dumpTotalCost,
      description: `Dump fee - ${location.name} - Ticket #${ticketNumber} - ${weightTons}t`,
      dump_location_id: dumpLocationId,
      dump_ticket_number: ticketNumber,
      net_weight_tons: weightTons,
    };
    const existingCost = await this.jobCostRepo.findOne({
      where: { job_id: jobId, dump_ticket_number: ticketNumber },
    });
    if (existingCost) {
      await this.jobCostRepo.update(existingCost.id, jobCostData);
    } else {
      await this.jobCostRepo.save(this.jobCostRepo.create(jobCostData));
    }

    // Sum all tickets for this job
    const allTickets = await this.ticketRepo.find({ where: { job_id: jobId } });
    const totalDump = allTickets.reduce((s, t) => s + Number(t.total_cost), 0);
    const totalCust = allTickets.reduce((s, t) => s + Number(t.customer_charges), 0);

    await this.jobRepo.update(jobId, {
      dump_location_id: dumpLocationId, dump_location_name: location.name,
      dump_total_cost: totalDump, customer_additional_charges: totalCust,
      dump_status: 'submitted', dump_submitted_at: new Date(), dump_submitted_by: userId,
    });

    // Auto-create draft invoice if customer has overage charges
    let invoiceId: string | null = null;
    if (customerCharges > 0) {
      const invNumResult = await this.invoiceRepo.query(
        `SELECT next_invoice_number($1) as num`, [tenantId],
      );
      const invNum = invNumResult[0].num;
      const today = new Date().toISOString().split('T')[0];
      const invoice = this.invoiceRepo.create({
        tenant_id: tenantId, invoice_number: invNum, customer_id: job.customer_id,
        job_id: jobId, status: 'draft', invoice_date: today,
        due_date: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
        subtotal: customerCharges, total: customerCharges, balance_due: customerCharges,
        tax_amount: 0,
        summary_of_work: `Auto-generated from dump ticket #${ticketNumber} at ${location.name}`,
      } as Partial<Invoice>);
      const savedInvoice = await this.invoiceRepo.save(invoice);

      // Create line items — tonnage overages
      let sortIdx = 0;
      if (customerTonnageOverage > 0) {
        const overTons = weightTons - includedTons;
        await this.lineItemRepo.save(this.lineItemRepo.create({
          invoice_id: savedInvoice.id,
          sort_order: sortIdx++,
          line_type: 'overage',
          name: `Weight overage: ${overTons.toFixed(2)} tons over ${includedTons} ton allowance @ $${overageRatePerTon}/ton`,
          quantity: 1,
          unit_rate: customerTonnageOverage,
          amount: customerTonnageOverage,
          net_amount: customerTonnageOverage,
          is_taxable: false,
          tax_rate: 0,
          tax_amount: 0,
        }));
      }
      // Create line items — surcharge items
      for (const item of calculatedItems) {
        await this.lineItemRepo.save(this.lineItemRepo.create({
          invoice_id: savedInvoice.id,
          sort_order: sortIdx++,
          line_type: 'surcharge_item',
          name: item.label,
          quantity: item.quantity,
          unit_rate: item.chargePerUnit,
          amount: item.total,
          net_amount: item.total,
          is_taxable: false,
          tax_rate: 0,
          tax_amount: 0,
        }));
      }
      invoiceId = savedInvoice.id;

      // Resolve rental chain from job
      try {
        const link = await this.dataSource.query(
          'SELECT rental_chain_id FROM task_chain_links WHERE job_id = $1 LIMIT 1',
          [jobId],
        );
        if (link?.[0]?.rental_chain_id) {
          await this.invoiceRepo.update(savedInvoice.id, { rental_chain_id: link[0].rental_chain_id });
        }
      } catch { /* non-fatal */ }

      // Mark this ticket as invoiced
      await this.ticketRepo.update(savedTicket.id, { invoiced: true, invoice_id: savedInvoice.id });
    }

    await this.logRepo.save(this.logRepo.create({
      tenant_id: tenantId, job_id: jobId, type: 'dump_slip_submitted', status: 'success',
      details: { ticketId: savedTicket.id, dumpCost: dumpTotalCost, customerCharges, invoiceId, ticketCount: allTickets.length },
    }));

    return { ticket: savedTicket, invoiceId, jobTotals: { dumpTotalCost: totalDump, customerAdditionalCharges: totalCust, ticketCount: allTickets.length } };
  }

  async getDumpSlip(tenantId: string, jobId: string) {
    const tickets = await this.ticketRepo.find({ where: { job_id: jobId, tenant_id: tenantId }, order: { created_at: 'ASC' } });
    const job = await this.jobRepo.findOne({ where: { id: jobId, tenant_id: tenantId } });
    return { tickets, jobTotals: { dumpTotalCost: job?.dump_total_cost || 0, customerAdditionalCharges: job?.customer_additional_charges || 0 } };
  }

  async reviewDumpSlip(tenantId: string, jobId: string) {
    const job = await this.jobRepo.findOne({ where: { id: jobId, tenant_id: tenantId } });
    if (!job) throw new NotFoundException('Job not found');

    job.dump_status = 'reviewed';
    await this.jobRepo.save(job);

    await this.logRepo.save(this.logRepo.create({
      tenant_id: tenantId,
      job_id: jobId,
      type: 'dump_slip_reviewed',
      status: 'success',
      details: { dump_total_cost: job.dump_total_cost },
    }));

    return job;
  }
}
