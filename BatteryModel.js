/**
 * ==============================================================================
 * MODULE: Electrochemical Battery Cell Simulation (Advanced 1-RC Thevenin Core)
 * Feature: Real-time SOC & SOH Degradation, Internal Resistance Dynamics
 * Developer: Jakkrit Jathongkham (Control & Automation Systems Engineering)
 * ==============================================================================
 */

export class BatteryCell {
    constructor(id, initialOcv, nominalAh, initialSoh = 1.0) {
        this.id = id;
        this.nominalCapacity = nominalAh;
        this.soh = initialSoh; // State of Health (1.0 = 100%, 0.8 = 80% Degraded)
        
        // Dynamic Capacity based on Health State
        this.capacityAh = nominalAh * this.soh;
        
        // Thevenin 1-RC Parameter Matrix (Scaled with SOH)
        this.ocv = initialOcv;           
        this.v_terminal = initialOcv;    
        this.r0 = 0.018 * (2.0 - this.soh); // ความต้านทานภายในจะสูงขึ้นเมื่อ SOH ลดลง
        this.rp = 0.007 * (1.5 - this.soh); 
        this.cp = 1400 * this.soh;          // ความสามารถในการเก็บประจุลดลงตามสภาพ SOH
        this.v_polarization = 0.0;       
        
        // Thermal State Parameter Arrays
        this.tempCore = 25.0;            
        this.massKg = 0.048;             
        this.specificHeat = 835;         
        this.ambientTemp = 25.0;         
        this.heatTransferCoeff = 1.2;   
        
        this.soc = this.estimateSocFromOcv(initialOcv); 
    }

    estimateSocFromOcv(v) {
        return Math.max(0, Math.min(1, (v - 3.0) / 1.2));
    }

    getOcvFromSoc(soc) {
        // สมการพหุนามอันดับ 5 จำลองแรงดันเคมีไฟฟ้าตกคร่อม
        return 3.0 + (soc * 1.22) - (Math.pow(soc, 2) * 0.08) + (Math.pow(soc, 3) * 0.06);
    }

    updatePhysicsStep(currentAmps, dtSeconds) {
        // 1. ประมวลผล Coulomb Counting ในส่วนลูปฟิสิกส์หลัก (รองรับการดึงประจุจากภายนอก)
        const ampHoursDelta = (currentAmps * dtSeconds) / 3600;
        this.soc += ampHoursDelta;
        this.soc = Math.max(0.0, Math.min(1.0, this.soc));
        
        // 2. Update Open Circuit Voltage
        this.ocv = this.getOcvFromSoc(this.soc);

        // 3. RC Polarization State Calculus
        const dVp_dt = -(this.v_polarization / (this.rp * this.cp)) + (currentAmps / this.cp);
        this.v_polarization += dVp_dt * dtSeconds;

        // 4. Combined Thevenin Terminal Voltage Equation
        this.v_terminal = this.ocv + (currentAmps * this.r0) + this.v_polarization;

        // 5. Electro-Thermal Internal Heat Dispersion Model
        const heatGenerated = Math.pow(currentAmps, 2) * this.r0;
        const heatDissipated = this.heatTransferCoeff * (this.tempCore - this.ambientTemp);
        const dT_dt = (heatGenerated - heatDissipated) / (this.massKg * this.specificHeat);
        
        this.tempCore += dT_dt * dtSeconds;

        // 6. Microscopic SOH Degradation Simulation (เสื่อมสภาพเมื่ออุณหภูมิสูงและจ่ายกระแสหนัก)
        if (Math.abs(currentAmps) > 5.0 || this.tempCore > 45.0) {
            const agingFactor = (Math.abs(currentAmps) * 1e-7) * (this.tempCore / 25.0);
            this.soh = Math.max(0.5, this.soh - agingFactor * dtSeconds);
            this.capacityAh = this.nominalCapacity * this.soh;
        }
    }
}