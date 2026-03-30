import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DumpLocation, DumpLocationRate, DumpLocationSurcharge } from './entities/dump-location.entity';
import { Job } from '../jobs/entities/job.entity';
import { AutomationLog } from '../automation/entities/automation-log.entity';

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
    @InjectRepository(AutomationLog) private readonly logRepo: Repository<AutomationLog>,
  ) {}

  /* ───── Dump Locations CRUD ───── */

  findAll(tenantId: string) {
    return this.locRepo.find({
      where: { tenant_id: tenantId, is_active: true },
      relations: ['rates', 'surcharges'],
      order: { name: 'ASC' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const loc = await this.locRepo.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['rates', 'surcharges'],
    });
    if (!loc) throw new NotFoundException('Dump location not found');
    return loc;
  }

  async create(tenantId: string, body: Record<string, unknown>) {
    const loc = this.locRepo.create({ ...body, tenant_id: tenantId } as Partial<DumpLocation>);
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
    return this.rateRepo.find({ where: { dump_location_id: locationId, is_active: true } });
  }

  async addRate(tenantId: string, locationId: string, body: Record<string, unknown>) {
    await this.findOne(tenantId, locationId);
    const rate = this.rateRepo.create({ ...body, dump_location_id: locationId } as Partial<DumpLocationRate>);
    return this.rateRepo.save(rate);
  }

  async updateRate(rateId: string, body: Record<string, unknown>) {
    const rate = await this.rateRepo.findOneBy({ id: rateId });
    if (!rate) throw new NotFoundException('Rate not found');
    Object.assign(rate, body);
    return this.rateRepo.save(rate);
  }

  async removeRate(rateId: string) {
    const rate = await this.rateRepo.findOneBy({ id: rateId });
    if (!rate) throw new NotFoundException('Rate not found');
    rate.is_active = false;
    return this.rateRepo.save(rate);
  }

  /* ───── Surcharges ───── */

  async getSurcharges(tenantId: string, locationId: string) {
    await this.findOne(tenantId, locationId);
    return this.surRepo.find({
      where: { dump_location_id: locationId, is_active: true },
      order: { sort_order: 'ASC' },
    });
  }

  async addSurcharge(tenantId: string, locationId: string, body: Record<string, unknown>) {
    await this.findOne(tenantId, locationId);
    const sur = this.surRepo.create({ ...body, dump_location_id: locationId } as Partial<DumpLocationSurcharge>);
    return this.surRepo.save(sur);
  }

  async updateSurcharge(surchargeId: string, body: Record<string, unknown>) {
    const sur = await this.surRepo.findOneBy({ id: surchargeId });
    if (!sur) throw new NotFoundException('Surcharge not found');
    Object.assign(sur, body);
    return this.surRepo.save(sur);
  }

  async removeSurcharge(surchargeId: string) {
    const sur = await this.surRepo.findOneBy({ id: surchargeId });
    if (!sur) throw new NotFoundException('Surcharge not found');
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
    const job = await this.jobRepo.findOne({ where: { id: jobId, tenant_id: tenantId } });
    if (!job) throw new NotFoundException('Job not found');

    const dumpLocationId = body.dump_location_id as string;
    const wasteType = body.dump_waste_type as string;
    const weightTons = Number(body.dump_weight_tons) || 0;
    const overageItems = (body.overage_items as Array<{ type: string; quantity: number }>) || [];

    // Find dump location with rates and surcharges
    const location = await this.locRepo.findOne({
      where: { id: dumpLocationId },
      relations: ['rates', 'surcharges'],
    });
    if (!location) throw new NotFoundException('Dump location not found');

    // Find rate for waste type
    const rate = location.rates.find(r => r.waste_type === wasteType && r.is_active);
    const ratePerTon = rate ? Number(rate.rate_per_ton) : 0;
    const minimumCharge = rate ? Number(rate.minimum_charge) || 0 : 0;

    // Calculate base cost
    const baseCost = Math.max(weightTons * ratePerTon, minimumCharge);

    // Calculate overage items
    let totalDumpOverage = 0;
    let totalCustomerCharges = 0;
    const calculatedOverageItems: Array<{ type: string; label: string; quantity: number; chargePerUnit: number; total: number }> = [];

    for (const item of overageItems) {
      const surcharge = location.surcharges.find(s => s.item_type === item.type && s.is_active);
      if (surcharge) {
        const qty = Number(item.quantity) || 0;
        const dumpTotal = Number(surcharge.dump_charge) * qty;
        const customerTotal = Number(surcharge.customer_charge) * qty;
        totalDumpOverage += dumpTotal;
        totalCustomerCharges += customerTotal;
        calculatedOverageItems.push({
          type: surcharge.item_type,
          label: surcharge.label,
          quantity: qty,
          chargePerUnit: Number(surcharge.dump_charge),
          total: dumpTotal,
        });
      }
    }

    const dumpTotalCost = baseCost + totalDumpOverage;

    // Update job
    job.dump_location_id = dumpLocationId;
    job.dump_location_name = location.name;
    job.dump_ticket_number = (body.dump_ticket_number as string) || '';
    job.dump_ticket_photo = (body.dump_ticket_photo as string) || '';
    job.dump_weight_tons = weightTons;
    job.dump_waste_type = wasteType;
    job.dump_base_cost = baseCost;
    job.dump_overage_items = calculatedOverageItems;
    job.dump_overage_charges = totalDumpOverage;
    job.dump_total_cost = dumpTotalCost;
    job.customer_additional_charges = totalCustomerCharges;
    job.dump_submitted_at = new Date();
    job.dump_submitted_by = userId;
    job.dump_status = 'submitted';

    await this.jobRepo.save(job);

    // Log to automation_logs
    await this.logRepo.save(this.logRepo.create({
      tenant_id: tenantId,
      job_id: jobId,
      type: 'dump_slip_submitted',
      status: 'success',
      details: {
        dump_location_id: dumpLocationId,
        dump_location_name: location.name,
        waste_type: wasteType,
        weight_tons: weightTons,
        base_cost: baseCost,
        overage_charges: totalDumpOverage,
        customer_additional_charges: totalCustomerCharges,
        total_cost: dumpTotalCost,
        submitted_by: userId,
      },
    }));

    return job;
  }

  async getDumpSlip(tenantId: string, jobId: string) {
    const job = await this.jobRepo.findOne({ where: { id: jobId, tenant_id: tenantId } });
    if (!job) throw new NotFoundException('Job not found');

    return {
      job_id: job.id,
      job_number: job.job_number,
      dump_location_id: job.dump_location_id,
      dump_location_name: job.dump_location_name,
      dump_ticket_number: job.dump_ticket_number,
      dump_ticket_photo: job.dump_ticket_photo,
      dump_weight_tons: job.dump_weight_tons,
      dump_waste_type: job.dump_waste_type,
      dump_base_cost: job.dump_base_cost,
      dump_overage_items: job.dump_overage_items,
      dump_overage_charges: job.dump_overage_charges,
      dump_total_cost: job.dump_total_cost,
      customer_additional_charges: job.customer_additional_charges,
      dump_submitted_at: job.dump_submitted_at,
      dump_submitted_by: job.dump_submitted_by,
      dump_status: job.dump_status,
    };
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
