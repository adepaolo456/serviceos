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
  ) {}

  @Public()
  @Post()
  async seed(@Query('secret') secret: string) {
    if (secret !== 'SEED_2026') return { error: 'Invalid secret' };

    const tenant = await this.tenantRepo.findOne({ where: { slug: 'rent-this-dumpster-mnbxs4jm' } });
    if (!tenant) return { error: 'Tenant not found' };
    const tid = tenant.id;
    const log: string[] = [];

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
      { first_name: 'South Shore', last_name: 'Renovations', email: 'jobs@southshorereno.com', phone: '5085552004', type: 'commercial', company_name: 'South Shore Renovations', billing_address: { street: '150 Washington Street', city: 'Hanover', state: 'MA', zip: '02339' }, pricing_tier: 'discount', discount_percentage: 15 },
    ];
    const custIds: Record<string, string> = {};
    for (const c of custData) {
      let cust: any = await this.customerRepo.findOne({ where: { tenant_id: tid, email: c.email } });
      if (!cust) {
        cust = await this.customerRepo.save(this.customerRepo.create({ ...c, tenant_id: tid } as any));
        log.push(`Created customer: ${c.first_name} ${c.last_name}`);
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
      { waste_type: 'cnd', waste_type_label: 'C&D (Construction & Demolition)', rate_per_ton: 185 },
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
        loc = await this.dumpLocRepo.save(this.dumpLocRepo.create({ ...d, tenant_id: tid } as any));
        log.push(`Created dump: ${d.name}`);
      } else {
        await this.dumpLocRepo.update(loc.id, d as any);
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
}
