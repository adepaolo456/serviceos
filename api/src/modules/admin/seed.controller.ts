import { Controller, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Public } from '../../common/decorators';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Asset } from '../assets/entities/asset.entity';
import { Job } from '../jobs/entities/job.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import { User } from '../auth/entities/user.entity';
import { DumpLocation, DumpLocationRate, DumpLocationSurcharge } from '../dump-locations/entities/dump-location.entity';
import { DumpTicket } from '../dump-locations/entities/dump-ticket.entity';
import { DeliveryZone } from '../pricing/entities/delivery-zone.entity';
import * as bcrypt from 'bcrypt';

@Controller('admin/seed')
export class SeedController {
  constructor(
    @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(Asset) private assetRepo: Repository<Asset>,
    @InjectRepository(Job) private jobRepo: Repository<Job>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(DumpLocation) private dumpLocRepo: Repository<DumpLocation>,
    @InjectRepository(DumpLocationRate) private rateRepo: Repository<DumpLocationRate>,
    @InjectRepository(DumpLocationSurcharge) private surRepo: Repository<DumpLocationSurcharge>,
    @InjectRepository(DumpTicket) private ticketRepo: Repository<DumpTicket>,
    @InjectRepository(DeliveryZone) private zoneRepo: Repository<DeliveryZone>,
  ) {}

  @Public()
  @Post()
  async seed(@Query('secret') secret: string) {
    if (secret !== 'SEED_2026') return { error: 'Invalid secret' };

    const tenant = await this.tenantRepo.findOne({ where: { slug: 'rent-this-dumpster-mnbxs4jm' } });
    if (!tenant) return { error: 'Tenant not found' };
    const tid = tenant.id;
    const log: string[] = [];

    // --- CUSTOMER OVERAGE RATES ---
    await this.tenantRepo.update(tid, {
      customer_overage_rates: {
        perTon: { dtm: 185, cnd: 185, msw: 150, shingles: 172 },
        surchargeItems: {
          mattress: { label: 'Mattress', price: 100 },
          box_spring: { label: 'Box Spring', price: 100 },
          tire_car: { label: 'Tire (Car)', price: 50 },
          propane_tank: { label: 'Propane Tank', price: 50 },
          refrigerator: { label: 'Refrigerator', price: 75 },
          air_conditioner: { label: 'Air Conditioner', price: 50 },
          tv: { label: 'TV/Monitor', price: 50 },
          couch: { label: 'Couch/Sofa', price: 75 },
          hot_water_heater: { label: 'Hot Water Heater', price: 50 },
        },
      },
    } as any);
    log.push('Updated customer_overage_rates on tenant');

    // --- TEAM ---
    const owner = await this.userRepo.findOne({ where: { tenant_id: tid, role: 'owner' } });
    const pw = await bcrypt.hash('TestDriver2026', 12);
    const teamData = [
      { first_name: 'Mike', last_name: 'Terrio', email: 'mike@rentthisdumpster.com', phone: '5085550102', role: 'driver', is_billable: true, billable_since: new Date() },
      { first_name: 'Jake', last_name: 'Sullivan', email: 'jake@rentthisdumpster.com', phone: '5085550103', role: 'driver', is_billable: true, billable_since: new Date() },
      { first_name: 'Sarah', last_name: 'Mitchell', email: 'sarah@rentthisdumpster.com', phone: '5085550104', role: 'dispatcher' },
      { first_name: 'Lisa', last_name: 'Chen', email: 'lisa@rentthisdumpster.com', phone: '5085550105', role: 'secretary' },
    ];
    const teamIds: Record<string, string> = {};
    if (owner) teamIds['Anthony DePaolo'] = owner.id;

    for (const t of teamData) {
      let u: any = await this.userRepo.findOne({ where: { email: t.email } });
      if (!u) {
        u = await this.userRepo.save(this.userRepo.create({ ...t, tenant_id: tid, password_hash: pw, vehicle_info: null } as any));
        log.push(`Created team: ${t.first_name} ${t.last_name}`);
      }
      teamIds[`${t.first_name} ${t.last_name}`] = u.id;
    }

    // Vehicles on team members
    const mikeId = teamIds['Mike Terrio'];
    const jakeId = teamIds['Jake Sullivan'];
    if (mikeId) await this.userRepo.update(mikeId, { vehicle_info: { year: '2022', make: 'Hino', model: '258', plate: 'RT-2022' } });
    if (jakeId) await this.userRepo.update(jakeId, { vehicle_info: { year: '2020', make: 'Peterbilt', model: '348', plate: 'RT-2020' } });

    // --- CUSTOMERS ---
    const custData = [
      { first_name: 'John', last_name: 'McCarthy', email: 'john.mccarthy@email.com', phone: '5085551001', type: 'residential', billing_address: { street: '45 Pearl Street', city: 'Brockton', state: 'MA', zip: '02301' } },
      { first_name: 'Maria', last_name: 'Santos', email: 'maria.santos@email.com', phone: '5085551002', type: 'residential', billing_address: { street: '120 West Elm Street', city: 'East Bridgewater', state: 'MA', zip: '02333' } },
      { first_name: 'David', last_name: 'Kim', email: 'david.kim@email.com', phone: '5085551003', type: 'residential', billing_address: { street: '88 Summer Street', city: 'Stoughton', state: 'MA', zip: '02072' } },
      { first_name: 'Karen', last_name: "O'Brien", email: 'karen.obrien@email.com', phone: '5085551004', type: 'residential', billing_address: { street: '15 Maple Drive', city: 'Whitman', state: 'MA', zip: '02382' } },
      { first_name: 'Tom', last_name: 'Richards', email: 'tom.richards@email.com', phone: '5085551005', type: 'residential', billing_address: { street: '200 Centre Street', city: 'Abington', state: 'MA', zip: '02351' } },
      { first_name: 'Jennifer', last_name: 'Walsh', email: 'jen.walsh@email.com', phone: '5085551006', type: 'residential', billing_address: { street: '55 North Avenue', city: 'Rockland', state: 'MA', zip: '02370' } },
      { first_name: 'Robert', last_name: 'Patel', email: 'robert.patel@email.com', phone: '5085551007', type: 'residential', billing_address: { street: '340 Bedford Street', city: 'Bridgewater', state: 'MA', zip: '02324' } },
      { first_name: 'Amanda', last_name: 'Cruz', email: 'amanda.cruz@email.com', phone: '5085551008', type: 'residential', billing_address: { street: '78 Oak Street', city: 'Easton', state: 'MA', zip: '02356' } },
      { first_name: 'Mighty Dog', last_name: 'Roofing', email: 'office@mightydogroofing.com', phone: '5085552001', type: 'commercial', company_name: 'Mighty Dog Roofing', billing_address: { street: '500 Industrial Drive', city: 'Brockton', state: 'MA', zip: '02301' }, pricing_tier: 'commercial', exempt_extra_day_charges: true },
      { first_name: 'Best Brothers', last_name: 'Construction', email: 'dispatch@bestbrothers.com', phone: '5085552002', type: 'commercial', company_name: 'Best Brothers Construction', billing_address: { street: '23 Josephs Road', city: 'Brockton', state: 'MA', zip: '02301' }, pricing_tier: 'discount', discount_percentage: 10, exempt_extra_day_charges: true },
      { first_name: 'Casa Design', last_name: 'Build', email: 'info@casadesign.com', phone: '6178286150', type: 'commercial', company_name: 'Casa Design Build', billing_address: { street: '89 Tosca Drive', city: 'Stoughton', state: 'MA', zip: '02072' }, pricing_tier: 'commercial', exempt_extra_day_charges: true },
      { first_name: 'South Shore', last_name: 'Renovations', email: 'jobs@southshorereno.com', phone: '5085552004', type: 'commercial', company_name: 'South Shore Renovations', billing_address: { street: '150 Washington Street', city: 'Hanover', state: 'MA', zip: '02339' }, pricing_tier: 'discount', discount_percentage: 15, exempt_extra_day_charges: true },
    ];
    const custIds: Record<string, string> = {};
    for (const c of custData) {
      let cust: any = await this.customerRepo.findOne({ where: { tenant_id: tid, email: c.email } });
      if (!cust) {
        cust = await this.customerRepo.save(this.customerRepo.create({ ...c, tenant_id: tid } as any));
        log.push(`Created customer: ${c.first_name} ${c.last_name}`);
      } else {
        // Update existing customer with seed values (pricing_tier, discount, exempt flags)
        const updates: any = {};
        if ((c as any).pricing_tier) updates.pricing_tier = (c as any).pricing_tier;
        if ((c as any).discount_percentage != null) updates.discount_percentage = (c as any).discount_percentage;
        if ((c as any).exempt_extra_day_charges != null) updates.exempt_extra_day_charges = (c as any).exempt_extra_day_charges;
        if ((c as any).company_name) updates.company_name = (c as any).company_name;
        if (Object.keys(updates).length > 0) {
          await this.customerRepo.update(cust.id, updates);
          log.push(`Updated customer: ${c.first_name} ${c.last_name}`);
        }
      }
      custIds[c.email] = cust.id;
    }

    // --- ASSETS ---
    const assetBatch: Array<{ identifier: string; subtype: string; status: string; staged_waste_type?: string; staged_at?: Date; staged_notes?: string; needs_dump?: boolean }> = [];
    for (let i = 1; i <= 8; i++) assetBatch.push({ identifier: `D-100${i}`, subtype: '10yd', status: i <= 5 ? 'available' : i <= 7 ? 'deployed' : 'maintenance' });
    for (let i = 1; i <= 10; i++) {
      if (i === 10) assetBatch.push({ identifier: `D-15${String(i).padStart(2, '0')}`, subtype: '15yd', status: 'full_staged', staged_waste_type: 'cnd', staged_at: new Date(Date.now() - 86400000), staged_notes: 'Heavy concrete load', needs_dump: true });
      else if (i <= 6) assetBatch.push({ identifier: `D-15${String(i).padStart(2, '0')}`, subtype: '15yd', status: 'available' });
      else assetBatch.push({ identifier: `D-15${String(i).padStart(2, '0')}`, subtype: '15yd', status: 'deployed' });
    }
    for (let i = 1; i <= 10; i++) {
      if (i === 10) assetBatch.push({ identifier: `D-20${String(i).padStart(2, '0')}`, subtype: '20yd', status: 'full_staged', staged_waste_type: 'msw', staged_at: new Date(Date.now() - 2 * 86400000), needs_dump: true });
      else if (i <= 5) assetBatch.push({ identifier: `D-20${String(i).padStart(2, '0')}`, subtype: '20yd', status: 'available' });
      else assetBatch.push({ identifier: `D-20${String(i).padStart(2, '0')}`, subtype: '20yd', status: 'deployed' });
    }

    let assetCount = 0;
    const assetIds: Record<string, string> = {};
    for (const a of assetBatch) {
      let asset: any = await this.assetRepo.findOne({ where: { tenant_id: tid, identifier: a.identifier } });
      if (!asset) {
        asset = await this.assetRepo.save(this.assetRepo.create({ ...a, tenant_id: tid, asset_type: 'dumpster' } as any));
        assetCount++;
      } else {
        await this.assetRepo.update(asset.id, a as any);
      }
      assetIds[a.identifier] = asset.id;
    }
    log.push(`Assets: ${assetCount} created, ${assetBatch.length} total`);

    // --- DUMP LOCATIONS ---
    const dumpData = [
      { name: 'Recycling Solutions', address: '35 Thrasher Street', city: 'Raynham', state: 'MA', zip: '02767', latitude: 41.9237, longitude: -71.0437, operating_hours: 'Mon-Fri 7:00 AM - 4:00 PM, Sat 7:00 AM - 1:00 PM' },
      { name: 'Brockton Transfer Station', address: '333 Oak Hill Way', city: 'Brockton', state: 'MA', zip: '02301', latitude: 42.0834, longitude: -71.0184, operating_hours: 'Mon-Fri 7:00 AM - 4:30 PM, Sat 7:00 AM - 12:00 PM' },
      { name: 'Stoughton Transfer Station', address: '246 Walnut St', city: 'Stoughton', state: 'MA', zip: '02072', latitude: 42.1245, longitude: -71.1028, operating_hours: 'Mon-Fri 7:00 AM - 4:00 PM, Sat 7:00 AM - 12:00 PM' },
      { name: 'SEMASS Resource Recovery', address: '141 Cranberry Hwy', city: 'Rochester', state: 'MA', zip: '02770', latitude: 41.7587, longitude: -70.8282, operating_hours: 'Mon-Fri 6:00 AM - 4:00 PM' },
    ];

    const rates = [
      { waste_type: 'dtm', waste_type_label: 'DTM (Demo/Mixed)', rate_per_ton: 170 },
      { waste_type: 'cnd', waste_type_label: 'C&D (Construction & Demolition)', rate_per_ton: 164 },
      { waste_type: 'msw', waste_type_label: 'MSW (Municipal Solid Waste)', rate_per_ton: 150 },
      { waste_type: 'shingles', waste_type_label: 'Shingles', rate_per_ton: 172 },
    ];

    const surcharges = [
      { item_type: 'mattress', label: 'Mattress', dump_charge: 100, customer_charge: 100 },
      { item_type: 'box_spring', label: 'Box Spring', dump_charge: 100, customer_charge: 100 },
      { item_type: 'tire_car', label: 'Tire (Car)', dump_charge: 50, customer_charge: 50 },
      { item_type: 'propane_tank', label: 'Propane Tank', dump_charge: 50, customer_charge: 50 },
      { item_type: 'refrigerator', label: 'Refrigerator', dump_charge: 75, customer_charge: 75 },
      { item_type: 'air_conditioner', label: 'Air Conditioner', dump_charge: 50, customer_charge: 50 },
    ];

    const dumpIds: Record<string, string> = {};
    for (const d of dumpData) {
      let loc: any = await this.dumpLocRepo.findOne({ where: { tenant_id: tid, name: d.name } });
      if (!loc) {
        loc = await this.dumpLocRepo.save(this.dumpLocRepo.create({ ...d, tenant_id: tid, fuel_env_surcharge_per_ton: 4.08 } as any));
        log.push(`Created dump: ${d.name}`);
      } else {
        await this.dumpLocRepo.update(loc.id, { ...d, fuel_env_surcharge_per_ton: 4.08 } as any);
      }
      dumpIds[d.name] = loc.id;

      // Clear and recreate rates
      await this.rateRepo.delete({ dump_location_id: loc.id });
      const locRates = d.name === 'SEMASS Resource Recovery' ? rates.filter(r => r.waste_type !== 'shingles') : rates;
      for (const r of locRates) {
        await this.rateRepo.save(this.rateRepo.create({ ...r, dump_location_id: loc.id } as any));
      }

      // Clear and recreate surcharges
      await this.surRepo.delete({ dump_location_id: loc.id });
      const locSur = d.name === 'SEMASS Resource Recovery' ? surcharges.filter(s => !['box_spring', 'propane_tank'].includes(s.item_type)) : surcharges;
      for (const s of locSur) {
        await this.surRepo.save(this.surRepo.create({ ...s, dump_location_id: loc.id } as any));
      }
    }

    // --- YARD LOCATION ---
    await this.tenantRepo.update(tid, {
      yard_latitude: 42.0834,
      yard_longitude: -71.0184,
      yard_address: { street: '100 Industrial Park Rd', city: 'Brockton', state: 'MA', zip: '02301' },
    } as any);
    log.push('Set yard location: Brockton, MA (42.0834, -71.0184)');

    // --- DELIVERY ZONES ---
    await this.zoneRepo.delete({ tenant_id: tid });
    const zones = [
      { zone_name: 'Zone 1', min_miles: 0, max_miles: 15, surcharge: 0, sort_order: 1 },
      { zone_name: 'Zone 2', min_miles: 15, max_miles: 30, surcharge: 50, sort_order: 2 },
      { zone_name: 'Zone 3', min_miles: 30, max_miles: 45, surcharge: 100, sort_order: 3 },
      { zone_name: 'Zone 4', min_miles: 45, max_miles: 60, surcharge: 150, sort_order: 4 },
    ];
    for (const z of zones) {
      await this.zoneRepo.save(this.zoneRepo.create({ ...z, tenant_id: tid }));
    }
    log.push(`Created ${zones.length} delivery zones`);

    // --- SUMMARY ---
    const custCount = await this.customerRepo.count({ where: { tenant_id: tid } });
    const assetTotal = await this.assetRepo.count({ where: { tenant_id: tid } });
    const teamCount = await this.userRepo.count({ where: { tenant_id: tid } });
    const dumpCount = await this.dumpLocRepo.count({ where: { tenant_id: tid } });

    return {
      message: 'Seed complete',
      summary: { customers: custCount, assets: assetTotal, team: teamCount, dumpLocations: dumpCount },
      log,
    };
  }

  @Public()
  @Post('jobs')
  async seedJobs(@Query('secret') secret: string) {
    if (secret !== 'SEED_2026') return { error: 'Invalid secret' };

    try {
    const tenant = await this.tenantRepo.findOne({ where: { slug: 'rent-this-dumpster-mnbxs4jm' } });
    if (!tenant) return { error: 'Tenant not found' };
    const tid = tenant.id;
    const log: string[] = [];

    // Clear existing seed data in correct FK order:
    // 1. automation_logs (refs jobs)
    // 2. dump_tickets (refs jobs + invoices)
    // 3. invoices (refs jobs)
    // 4. jobs self-refs (parent_job_id)
    // 5. assets refs (current_job_id)
    // 6. jobs
    await this.jobRepo.query(`DELETE FROM automation_logs WHERE tenant_id = $1`, [tid]);
    await this.jobRepo.query(`UPDATE dump_tickets SET invoice_id = NULL WHERE tenant_id = $1`, [tid]);
    await this.jobRepo.query(`DELETE FROM dump_tickets WHERE tenant_id = $1`, [tid]);
    await this.jobRepo.query(`DELETE FROM payments WHERE tenant_id = $1`, [tid]);
    await this.jobRepo.query(`DELETE FROM invoices WHERE tenant_id = $1`, [tid]);
    await this.jobRepo.query(`UPDATE jobs SET parent_job_id = NULL, linked_job_ids = '[]'::jsonb WHERE tenant_id = $1`, [tid]);
    await this.jobRepo.query(`UPDATE assets SET current_job_id = NULL WHERE tenant_id = $1`, [tid]);
    await this.jobRepo.query(`DELETE FROM jobs WHERE tenant_id = $1`, [tid]);
    log.push('Cleared existing jobs, invoices, dump tickets, and automation logs');

    // Lookup helpers
    const findCust = async (email: string) => (await this.customerRepo.findOne({ where: { tenant_id: tid, email } }))?.id;
    const findAsset = async (id: string) => (await this.assetRepo.findOne({ where: { tenant_id: tid, identifier: id } }))?.id;
    const findDriver = async (email: string) => (await this.userRepo.findOne({ where: { email } }))?.id;
    const findDump = async (name: string) => (await this.dumpLocRepo.findOne({ where: { tenant_id: tid, name } }))?.id;

    const mike = await findDriver('mike@rentthisdumpster.com');
    const jake = await findDriver('jake@rentthisdumpster.com');

    const makeJob = (p: any) => this.jobRepo.create({ tenant_id: tid, job_number: `JOB-${Date.now().toString(36).slice(-4)}-${Math.floor(Math.random()*9000)+1000}`, priority: 'normal', source: 'manual', ...p } as any);
    const makeInv = (p: any) => this.invoiceRepo.create({ tenant_id: tid, ...p } as any);

    // --- JOB A: David Kim 20yd Delivery (completed, deployed) ---
    const custDavid = await findCust('david.kim@email.com');
    const assetA = await findAsset('D-2001');
    const jobA: any = await this.jobRepo.save(makeJob({
      customer_id: custDavid, job_type: 'delivery', asset_subtype: '20yd', service_type: 'dumpster_rental',
      service_address: { street: '88 Summer Street', city: 'Stoughton', state: 'MA', zip: '02072' },
      scheduled_date: '2026-03-20', scheduled_window_start: '08:00', scheduled_window_end: '12:00',
      status: 'completed', completed_at: new Date('2026-03-20T10:30:00'),
      assigned_driver_id: mike, asset_id: assetA, drop_off_asset_id: assetA, drop_off_asset_pin: 'D-2001',
      rental_days: 14, rental_start_date: '2026-03-20', rental_end_date: '2026-04-03',
      base_price: 800, total_price: 800,
    }));
    if (assetA) await this.assetRepo.update(assetA, { status: 'deployed', current_location: { street: '88 Summer Street', city: 'Stoughton', state: 'MA' }, current_job_id: jobA.id } as any);
    await this.invoiceRepo.save(makeInv({ invoice_number: 'INV-2026-0010', customer_id: custDavid, job_id: jobA.id, status: 'paid', source: 'booking', invoice_type: 'rental', subtotal: 800, total: 800, amount_paid: 800, balance_due: 0, paid_at: new Date('2026-03-20'), payment_method: 'card', line_items: [{ description: '20yd Dumpster Rental — 14-day rental', quantity: 1, unitPrice: 800, amount: 800 }], notes: 'Paid at time of booking' }));
    log.push('Job A: David Kim 20yd Delivery (completed, deployed)');

    // --- JOB B: Jennifer Walsh 15yd Delivery (completed) ---
    const custJen = await findCust('jen.walsh@email.com');
    const assetB = await findAsset('D-1505');
    const jobB: any = await this.jobRepo.save(makeJob({
      customer_id: custJen, job_type: 'delivery', asset_subtype: '15yd', service_type: 'dumpster_rental',
      service_address: { street: '55 North Avenue', city: 'Rockland', state: 'MA', zip: '02370' },
      scheduled_date: '2026-03-15', status: 'completed', completed_at: new Date('2026-03-15T09:00:00'),
      assigned_driver_id: mike, asset_id: assetB, drop_off_asset_id: assetB,
      rental_days: 14, rental_start_date: '2026-03-15', rental_end_date: '2026-03-29',
      base_price: 700, total_price: 700,
    }));
    await this.invoiceRepo.save(makeInv({ invoice_number: 'INV-2026-0011', customer_id: custJen, job_id: jobB.id, status: 'paid', source: 'booking', invoice_type: 'rental', subtotal: 700, total: 700, amount_paid: 700, balance_due: 0, paid_at: new Date('2026-03-15'), payment_method: 'card', line_items: [{ description: '15yd Dumpster Rental — 14-day rental', quantity: 1, unitPrice: 700, amount: 700 }] }));

    // JOB B2: Jennifer Walsh Pickup (clean, no overage)
    const jobB2: any = await this.jobRepo.save(makeJob({
      customer_id: custJen, job_type: 'pickup', asset_subtype: '15yd', service_type: 'dumpster_rental',
      service_address: { street: '55 North Avenue', city: 'Rockland', state: 'MA', zip: '02370' },
      scheduled_date: '2026-03-25', status: 'completed', completed_at: new Date('2026-03-25T14:00:00'),
      assigned_driver_id: jake, asset_id: assetB, pick_up_asset_id: assetB,
      parent_job_id: jobB.id, dump_disposition: 'dumped',
    }));
    if (assetB) await this.assetRepo.update(assetB, { status: 'available', current_location: null, current_job_id: null } as any);
    await this.jobRepo.update(jobB.id, { linked_job_ids: [jobB2.id] });
    // Dump ticket: clean
    const dumpRS = await findDump('Recycling Solutions');
    await this.ticketRepo.save(this.ticketRepo.create({ job_id: jobB2.id, tenant_id: tid, dump_location_id: dumpRS, dump_location_name: 'Recycling Solutions', ticket_number: 'T-12445', waste_type: 'cnd', weight_tons: 1.8, base_cost: 295.20, dump_tonnage_cost: 295.20, fuel_env_cost: 7.34, overage_items: [], overage_charges: 0, dump_surcharge_cost: 0, total_cost: 302.54, customer_charges: 0, customer_tonnage_charge: 0, customer_surcharge_charge: 0, profit_margin: -302.54, submitted_by: jake, submitted_at: new Date('2026-03-25T14:30:00'), status: 'reviewed' } as any));
    log.push('Job B: Jennifer Walsh 15yd Delivery+Pickup (clean, no overage)');

    // --- JOB C: Robert Patel 20yd (HAS overage) ---
    const custRobert = await findCust('robert.patel@email.com');
    const assetC = await findAsset('D-2002');
    const jobC: any = await this.jobRepo.save(makeJob({
      customer_id: custRobert, job_type: 'delivery', asset_subtype: '20yd', service_type: 'dumpster_rental',
      service_address: { street: '340 Bedford Street', city: 'Bridgewater', state: 'MA', zip: '02324' },
      scheduled_date: '2026-03-10', status: 'completed', completed_at: new Date('2026-03-10T11:00:00'),
      assigned_driver_id: mike, asset_id: assetC, drop_off_asset_id: assetC,
      rental_days: 14, rental_start_date: '2026-03-10', rental_end_date: '2026-03-24',
      base_price: 800, total_price: 800,
    }));
    await this.invoiceRepo.save(makeInv({ invoice_number: 'INV-2026-0012', customer_id: custRobert, job_id: jobC.id, status: 'paid', source: 'booking', invoice_type: 'rental', subtotal: 800, total: 800, amount_paid: 800, balance_due: 0, paid_at: new Date('2026-03-10'), payment_method: 'card', line_items: [{ description: '20yd Dumpster Rental — 14-day rental', quantity: 1, unitPrice: 800, amount: 800 }] }));

    // JOB C2: Robert Patel Pickup (overage)
    const jobC2: any = await this.jobRepo.save(makeJob({
      customer_id: custRobert, job_type: 'pickup', asset_subtype: '20yd',
      service_address: { street: '340 Bedford Street', city: 'Bridgewater', state: 'MA', zip: '02324' },
      scheduled_date: '2026-03-28', status: 'completed', completed_at: new Date('2026-03-28T15:00:00'),
      assigned_driver_id: jake, asset_id: assetC, pick_up_asset_id: assetC,
      parent_job_id: jobC.id, dump_disposition: 'dumped', customer_additional_charges: 422, dump_status: 'submitted',
    }));
    if (assetC) await this.assetRepo.update(assetC, { status: 'available', current_location: null, current_job_id: null } as any);
    await this.jobRepo.update(jobC.id, { linked_job_ids: [jobC2.id] });
    // Overage invoice
    const invC: any = await this.invoiceRepo.save(makeInv({ invoice_number: 'INV-2026-0030', customer_id: custRobert, job_id: jobC.id, status: 'sent', source: 'dump_slip', invoice_type: 'overage', subtotal: 422, total: 422, amount_paid: 0, balance_due: 422, due_date: '2026-04-27', line_items: [{ description: 'Weight overage: 1.2 tons over 3 ton allowance @ $185/ton', quantity: 1, unitPrice: 222, amount: 222 }, { description: 'Mattress (qty: 2) @ $100/each', quantity: 2, unitPrice: 100, amount: 200 }], notes: 'Additional charges from dump slip #T-89234 at Brockton Transfer Station' }));
    const dumpBT = await findDump('Brockton Transfer Station');
    await this.ticketRepo.save(this.ticketRepo.create({ job_id: jobC2.id, tenant_id: tid, dump_location_id: dumpBT, dump_location_name: 'Brockton Transfer Station', ticket_number: 'T-89234', waste_type: 'cnd', weight_tons: 4.2, base_cost: 688.80, dump_tonnage_cost: 688.80, fuel_env_cost: 17.14, overage_items: [{ type: 'mattress', label: 'Mattress', quantity: 2, chargePerUnit: 100, total: 200 }], overage_charges: 200, dump_surcharge_cost: 200, total_cost: 905.94, customer_charges: 422, customer_tonnage_charge: 222, customer_surcharge_charge: 200, profit_margin: -483.94, submitted_by: jake, submitted_at: new Date('2026-03-28T15:30:00'), status: 'reviewed', invoiced: true, invoice_id: invC.id } as any));
    log.push('Job C: Robert Patel 20yd Delivery+Pickup (4.2t overage, $422 invoice)');

    // --- JOB D: South Shore Renovations 15yd (15% discount, MSW overage) ---
    const custSSR = await findCust('jobs@southshorereno.com');
    const assetD = await findAsset('D-1506');
    const jobD: any = await this.jobRepo.save(makeJob({
      customer_id: custSSR, job_type: 'delivery', asset_subtype: '15yd', service_type: 'dumpster_rental',
      service_address: { street: '150 Washington Street', city: 'Hanover', state: 'MA', zip: '02339' },
      scheduled_date: '2026-03-12', status: 'completed', completed_at: new Date('2026-03-12T08:30:00'),
      assigned_driver_id: jake, asset_id: assetD, drop_off_asset_id: assetD,
      rental_days: 14, base_price: 700, total_price: 595, discount_percentage: 15, discount_amount: 105,
    }));
    await this.invoiceRepo.save(makeInv({ invoice_number: 'INV-2026-0013', customer_id: custSSR, job_id: jobD.id, status: 'paid', source: 'booking', invoice_type: 'rental', subtotal: 700, total: 595, amount_paid: 595, balance_due: 0, paid_at: new Date('2026-03-12'), payment_method: 'card', line_items: [{ description: '15yd Dumpster Rental — 14-day rental', quantity: 1, unitPrice: 700, amount: 700 }, { description: 'Customer discount (15%)', quantity: 1, unitPrice: -105, amount: -105 }] }));

    const jobD2: any = await this.jobRepo.save(makeJob({
      customer_id: custSSR, job_type: 'pickup', asset_subtype: '15yd',
      service_address: { street: '150 Washington Street', city: 'Hanover', state: 'MA', zip: '02339' },
      scheduled_date: '2026-03-22', status: 'completed', completed_at: new Date('2026-03-22T16:00:00'),
      assigned_driver_id: mike, asset_id: assetD, pick_up_asset_id: assetD,
      parent_job_id: jobD.id, dump_disposition: 'dumped', customer_additional_charges: 75, dump_status: 'submitted',
    }));
    if (assetD) await this.assetRepo.update(assetD, { status: 'available', current_location: null, current_job_id: null } as any);
    await this.jobRepo.update(jobD.id, { linked_job_ids: [jobD2.id] });
    const dumpST = await findDump('Stoughton Transfer Station');
    const invD: any = await this.invoiceRepo.save(makeInv({ invoice_number: 'INV-2026-0031', customer_id: custSSR, job_id: jobD.id, status: 'sent', source: 'dump_slip', invoice_type: 'overage', subtotal: 75, total: 75, amount_paid: 0, balance_due: 75, due_date: '2026-04-21', line_items: [{ description: 'Weight overage: 0.5 tons over 2 ton allowance @ $150/ton', quantity: 1, unitPrice: 75, amount: 75 }] }));
    await this.ticketRepo.save(this.ticketRepo.create({ job_id: jobD2.id, tenant_id: tid, dump_location_id: dumpST, dump_location_name: 'Stoughton Transfer Station', ticket_number: 'T-45821', waste_type: 'msw', weight_tons: 2.5, base_cost: 375, dump_tonnage_cost: 375, fuel_env_cost: 10.20, overage_items: [], overage_charges: 0, dump_surcharge_cost: 0, total_cost: 385.20, customer_charges: 75, customer_tonnage_charge: 75, customer_surcharge_charge: 0, profit_margin: -310.20, submitted_by: mike, submitted_at: new Date('2026-03-22T16:30:00'), status: 'reviewed', invoiced: true, invoice_id: invD.id } as any));
    log.push('Job D: South Shore Renovations 15yd (15% off, 0.5t MSW overage, $75 invoice)');

    // --- JOB E: Tom Richards FAILED pickup ---
    const custTom = await findCust('tom.richards@email.com');
    const assetE = await findAsset('D-2005');
    // Original delivery for Tom
    const jobE0: any = await this.jobRepo.save(makeJob({
      customer_id: custTom, job_type: 'delivery', asset_subtype: '20yd', service_type: 'dumpster_rental',
      service_address: { street: '200 Centre Street', city: 'Abington', state: 'MA', zip: '02351' },
      scheduled_date: '2026-03-15', status: 'completed', completed_at: new Date('2026-03-15T14:00:00'),
      assigned_driver_id: jake, asset_id: assetE, drop_off_asset_id: assetE,
      rental_days: 14, rental_start_date: '2026-03-15', rental_end_date: '2026-03-29',
      base_price: 800, total_price: 800,
    }));
    await this.invoiceRepo.save(makeInv({ invoice_number: 'INV-2026-0014', customer_id: custTom, job_id: jobE0.id, status: 'paid', source: 'booking', invoice_type: 'rental', subtotal: 800, total: 800, amount_paid: 800, balance_due: 0, paid_at: new Date('2026-03-15'), payment_method: 'card', line_items: [{ description: '20yd Dumpster Rental — 14-day rental', quantity: 1, unitPrice: 800, amount: 800 }] }));
    if (assetE) await this.assetRepo.update(assetE, { status: 'deployed', current_location: { street: '200 Centre Street', city: 'Abington', state: 'MA' }, current_job_id: jobE0.id } as any);

    // Failed pickup
    const jobE: any = await this.jobRepo.save(makeJob({
      customer_id: custTom, job_type: 'pickup', asset_subtype: '20yd',
      service_address: { street: '200 Centre Street', city: 'Abington', state: 'MA', zip: '02351' },
      scheduled_date: '2026-03-27', status: 'failed', assigned_driver_id: mike, asset_id: assetE, pick_up_asset_id: assetE,
      parent_job_id: jobE0.id, is_failed_trip: true, failed_reason: 'Dumpster blocked — cannot access', failed_reason_code: 'dumpster_blocked', failed_at: new Date('2026-03-27T13:00:00'), cancelled_at: new Date('2026-03-27T13:00:00'),
    }));
    await this.invoiceRepo.save(makeInv({ invoice_number: 'INV-2026-0032', customer_id: custTom, job_id: jobE.id, status: 'sent', source: 'failed_trip', invoice_type: 'failure_charge', subtotal: 150, total: 150, amount_paid: 0, balance_due: 150, due_date: '2026-04-26', line_items: [{ description: 'Failed pickup charge — Dumpster blocked', quantity: 1, unitPrice: 150, amount: 150 }], notes: 'Driver arrived but job could not be completed. Reason: Dumpster blocked — cannot access' }));

    // Replacement pickup
    const jobE2: any = await this.jobRepo.save(makeJob({
      customer_id: custTom, job_type: 'pickup', asset_subtype: '20yd',
      service_address: { street: '200 Centre Street', city: 'Abington', state: 'MA', zip: '02351' },
      scheduled_date: '2026-03-31', status: 'confirmed', assigned_driver_id: mike, asset_id: assetE, pick_up_asset_id: assetE,
      parent_job_id: jobE.id, source: 'rescheduled_from_failure', placement_notes: 'Auto-created from failed job. Original failure reason: Dumpster blocked',
    }));
    await this.jobRepo.update(jobE.id, { linked_job_ids: [jobE2.id] });
    await this.jobRepo.update(jobE0.id, { linked_job_ids: [jobE.id, jobE2.id] });
    log.push('Job E: Tom Richards FAILED pickup + $150 charge + replacement scheduled 3/31');

    // --- TODAY'S JOBS (March 30) ---
    const custJohn = await findCust('john.mccarthy@email.com');
    const custMaria = await findCust('maria.santos@email.com');
    const custMDR = await findCust('office@mightydogroofing.com');
    const custBB = await findCust('dispatch@bestbrothers.com');
    const custAmanda = await findCust('amanda.cruz@email.com');

    // F: John McCarthy 20yd Delivery today
    const assetF = await findAsset('D-2006');
    const jobF: any = await this.jobRepo.save(makeJob({
      customer_id: custJohn, job_type: 'delivery', asset_subtype: '20yd', service_type: 'dumpster_rental',
      service_address: { street: '45 Pearl Street', city: 'Brockton', state: 'MA', zip: '02301' },
      scheduled_date: '2026-03-30', scheduled_window_start: '08:00', scheduled_window_end: '12:00',
      status: 'confirmed', assigned_driver_id: mike, asset_id: assetF, drop_off_asset_id: assetF,
      rental_days: 14, base_price: 800, total_price: 800,
    }));
    await this.invoiceRepo.save(makeInv({ invoice_number: 'INV-2026-0020', customer_id: custJohn, job_id: jobF.id, status: 'paid', source: 'booking', invoice_type: 'rental', subtotal: 800, total: 800, amount_paid: 800, balance_due: 0, paid_at: new Date('2026-03-30'), payment_method: 'card', line_items: [{ description: '20yd Dumpster Rental', quantity: 1, unitPrice: 800, amount: 800 }] }));
    log.push('Job F: John McCarthy 20yd Delivery today (confirmed, Mike)');

    // G: Maria Santos 15yd Delivery today
    const assetG = await findAsset('D-1507');
    const jobG: any = await this.jobRepo.save(makeJob({
      customer_id: custMaria, job_type: 'delivery', asset_subtype: '15yd', service_type: 'dumpster_rental',
      service_address: { street: '120 West Elm Street', city: 'East Bridgewater', state: 'MA', zip: '02333' },
      scheduled_date: '2026-03-30', scheduled_window_start: '08:00', scheduled_window_end: '12:00',
      status: 'confirmed', assigned_driver_id: mike, asset_id: assetG,
      rental_days: 14, base_price: 700, total_price: 700,
    }));
    await this.invoiceRepo.save(makeInv({ invoice_number: 'INV-2026-0021', customer_id: custMaria, job_id: jobG.id, status: 'paid', source: 'booking', invoice_type: 'rental', subtotal: 700, total: 700, amount_paid: 700, balance_due: 0, paid_at: new Date('2026-03-30'), payment_method: 'card', line_items: [{ description: '15yd Dumpster Rental', quantity: 1, unitPrice: 700, amount: 700 }] }));
    log.push('Job G: Maria Santos 15yd Delivery today (confirmed, Mike)');

    // H: Mighty Dog Roofing 20yd Pickup today
    const assetH = await findAsset('D-2003');
    if (assetH) await this.assetRepo.update(assetH, { status: 'deployed', current_location: { street: '500 Industrial Drive', city: 'Brockton', state: 'MA' } } as any);
    await this.jobRepo.save(makeJob({
      customer_id: custMDR, job_type: 'pickup', asset_subtype: '20yd', service_type: 'dumpster_rental',
      service_address: { street: '500 Industrial Drive', city: 'Brockton', state: 'MA', zip: '02301' },
      scheduled_date: '2026-03-30', scheduled_window_start: '08:00', scheduled_window_end: '12:00',
      status: 'confirmed', assigned_driver_id: jake, asset_id: assetH, pick_up_asset_id: assetH,
    }));
    log.push('Job H: Mighty Dog Roofing 20yd Pickup today (confirmed, Jake)');

    // I: Best Brothers 10yd Delivery today (10% discount, unassigned)
    await this.jobRepo.save(makeJob({
      customer_id: custBB, job_type: 'delivery', asset_subtype: '10yd', service_type: 'dumpster_rental',
      service_address: { street: '23 Josephs Road', city: 'Brockton', state: 'MA', zip: '02301' },
      scheduled_date: '2026-03-30', scheduled_window_start: '12:00', scheduled_window_end: '17:00',
      status: 'pending', base_price: 600, total_price: 540, discount_percentage: 10, discount_amount: 60,
    }));
    await this.invoiceRepo.save(makeInv({ invoice_number: 'INV-2026-0022', customer_id: custBB, status: 'paid', source: 'booking', invoice_type: 'rental', subtotal: 600, total: 540, amount_paid: 540, balance_due: 0, paid_at: new Date('2026-03-30'), payment_method: 'card', line_items: [{ description: '10yd Dumpster Rental', quantity: 1, unitPrice: 600, amount: 600 }, { description: 'Customer discount (10%)', quantity: 1, unitPrice: -60, amount: -60 }] }));
    log.push('Job I: Best Brothers 10yd Delivery today (pending, unassigned, 10% off)');

    // J: Amanda Cruz 20yd Exchange today
    const assetJ1 = await findAsset('D-2007');
    const assetJ2 = await findAsset('D-2004');
    if (assetJ2) await this.assetRepo.update(assetJ2, { status: 'deployed', current_location: { street: '78 Oak Street', city: 'Easton', state: 'MA' } } as any);
    await this.jobRepo.save(makeJob({
      customer_id: custAmanda, job_type: 'exchange', asset_subtype: '20yd', service_type: 'dumpster_rental',
      service_address: { street: '78 Oak Street', city: 'Easton', state: 'MA', zip: '02356' },
      scheduled_date: '2026-03-30', scheduled_window_start: '12:00', scheduled_window_end: '17:00',
      status: 'confirmed', assigned_driver_id: jake, asset_id: assetJ2,
      drop_off_asset_id: assetJ1, pick_up_asset_id: assetJ2,
      base_price: 800, total_price: 800,
    }));
    await this.invoiceRepo.save(makeInv({ invoice_number: 'INV-2026-0023', customer_id: custAmanda, status: 'paid', source: 'booking', invoice_type: 'rental', subtotal: 800, total: 800, amount_paid: 800, balance_due: 0, paid_at: new Date('2026-03-30'), payment_method: 'card', line_items: [{ description: '20yd Dumpster Exchange', quantity: 1, unitPrice: 800, amount: 800 }] }));
    log.push('Job J: Amanda Cruz 20yd Exchange today (confirmed, Jake)');

    // --- TOMORROW'S JOBS (March 31) ---
    const custKaren = await findCust('karen.obrien@email.com');
    const custCasa = await findCust('info@casadesign.com');

    await this.jobRepo.save(makeJob({
      customer_id: custKaren, job_type: 'delivery', asset_subtype: '15yd', service_type: 'dumpster_rental',
      service_address: { street: '15 Maple Drive', city: 'Whitman', state: 'MA', zip: '02382' },
      scheduled_date: '2026-03-31', scheduled_window_start: '08:00', scheduled_window_end: '12:00',
      status: 'pending', base_price: 700, total_price: 700,
    }));
    await this.invoiceRepo.save(makeInv({ invoice_number: 'INV-2026-0024', customer_id: custKaren, status: 'paid', source: 'booking', invoice_type: 'rental', subtotal: 700, total: 700, amount_paid: 700, balance_due: 0, paid_at: new Date('2026-03-31'), payment_method: 'card', line_items: [{ description: '15yd Dumpster Rental', quantity: 1, unitPrice: 700, amount: 700 }] }));
    log.push('Job K: Karen O\'Brien 15yd Delivery tomorrow (pending, unassigned)');

    await this.jobRepo.save(makeJob({
      customer_id: custCasa, job_type: 'delivery', asset_subtype: '20yd', service_type: 'dumpster_rental',
      service_address: { street: '89 Tosca Drive', city: 'Stoughton', state: 'MA', zip: '02072' },
      scheduled_date: '2026-03-31', status: 'confirmed', assigned_driver_id: jake,
      base_price: 800, total_price: 800,
    }));
    await this.invoiceRepo.save(makeInv({ invoice_number: 'INV-2026-0025', customer_id: custCasa, status: 'paid', source: 'booking', invoice_type: 'rental', subtotal: 800, total: 800, amount_paid: 800, balance_due: 0, paid_at: new Date('2026-03-31'), payment_method: 'card', line_items: [{ description: '20yd Dumpster Rental', quantity: 1, unitPrice: 800, amount: 800 }] }));
    log.push('Job L: Casa Design Build 20yd Delivery tomorrow (confirmed, Jake)');

    // --- VERIFICATION ---
    const jobsByStatus = await this.jobRepo.query(`SELECT status, COUNT(*) as count FROM jobs WHERE tenant_id = $1 GROUP BY status ORDER BY status`, [tid]);
    const jobsByType = await this.jobRepo.query(`SELECT job_type, COUNT(*) as count FROM jobs WHERE tenant_id = $1 GROUP BY job_type ORDER BY job_type`, [tid]);
    const invByStatus = await this.invoiceRepo.query(`SELECT status, source, COUNT(*) as count, SUM(total) as total FROM invoices WHERE tenant_id = $1 GROUP BY status, source ORDER BY status, source`, [tid]);
    const ticketCount = await this.ticketRepo.count({ where: { tenant_id: tid } });
    const assetsByStatus = await this.assetRepo.query(`SELECT status, COUNT(*) as count FROM assets WHERE tenant_id = $1 GROUP BY status ORDER BY status`, [tid]);
    const todayJobs = await this.jobRepo.count({ where: { tenant_id: tid, scheduled_date: '2026-03-30' } });
    const tomorrowJobs = await this.jobRepo.count({ where: { tenant_id: tid, scheduled_date: '2026-03-31' } });

    return {
      message: 'Jobs seeded',
      log,
      verification: {
        jobsByStatus, jobsByType, invoicesByStatusSource: invByStatus,
        dumpTickets: ticketCount, assetsByStatus,
        todayJobs, tomorrowJobs,
      },
    };
    } catch (err: any) {
      return { error: err.message, stack: err.stack?.split('\n').slice(0, 5) };
    }
  }
}
