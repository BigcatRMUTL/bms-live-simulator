/**
 * ==============================================================================
 * MODULE: State of Charge (SOC) Advanced Estimation Engine
 * Feature: Temperature Compensation Matrix, Extended Kalman Filter (EKF) Simulation
 * Developer: Jakkrit Jathongkham (Control & Automation Systems Engineering)
 * ==============================================================================
 */

export class StateOfChargeEstimator {
    constructor() {
        // ค่าความคลาดเคลื่อนสมมติ (Covariance) สำหรับระบบ EKF Simulation
        this.errorCovariance = 0.01;
        this.processNoise = 1e-5;
        this.measurementNoise = 0.001;
    }

    /**
     * คำนวณหาค่าตัวคูณชดเชยประจุตามอุณหภูมิ (Temperature Derating Factor)
     * เพราะความจุของเซลล์เคมีไฟฟ้าจะลดลงเมื่ออยู่ในสภาวะที่อุณหภูมิต่ำหรือสูงเกินขีดจำกัด
     */
    getTemperatureCompensation(tempCore) {
        if (tempCore < 15) {
            return 0.85; // ความจุลดลง 15% ในที่เย็นจัด
        } else if (tempCore > 50) {
            return 0.92; // ความจุลดลง 8% ในที่ร้อนจัดจากความต้านทานภายในที่สูงขึ้น
        }
        return 1.0; // สภาวะอุณหภูมิปกติ (Optimal Zone)
    }

    /**
     * จำลองอัลกอริทึม Extended Kalman Filter (EKF) ผสาน Coulomb Counting กับ OCV-SOC Dynamics
     */
    estimateStateOfCharge(currentSoc, currentAmps, vTerminal, cellModel, dt) {
        // 1. Time Update (Predict Step): คำนวณจาก Coulomb Counting เบื้องต้น
        const tempFactor = this.getTemperatureCompensation(cellModel.tempCore);
        const dynamicCapacity = cellModel.capacityAh * tempFactor;
        const ampHoursDelta = (currentAmps * dt) / 3600;
        
        let predictedSoc = currentSoc + (ampHoursDelta / dynamicCapacity);
        predictedSoc = Math.max(0.0, Math.min(1.0, predictedSoc));

        // อัปเดตค่าความคลาดเคลื่อนคาดการณ์ (Predict Error Covariance)
        this.errorCovariance += this.processNoise;

        // 2. Measurement Update (Correct Step): เปรียบเทียบแรงดันขั้วจริงกับโมเดล OCV
        const predictedOcv = cellModel.getOcvFromSoc(predictedSoc);
        const predictedV = predictedOcv + (currentAmps * cellModel.r0) + cellModel.v_polarization;
        
        // คำนวณค่าความต่างระหว่างผลการวัดจริงกับผลจากการคาดการณ์ (Innovation Residual)
        const innovation = vTerminal - predictedV;

        // หาอนุพันธ์ของ OCV เทียบกับ SOC (Linearization Matrix / Jacobian H)
        // จากสูตรเดิม: 3.0 + (soc * 1.22) - (soc^2 * 0.08) + (soc^3 * 0.06)
        const h_jacobian = 1.22 - (2 * predictedSoc * 0.08) + (3 * Math.pow(predictedSoc, 2) * 0.06);

        // คำนวณหาอัตราการปรับตัว (Kalman Gain K)
        const innovationCovariance = (h_jacobian * this.errorCovariance * h_jacobian) + this.measurementNoise;
        const kalmanGain = (this.errorCovariance * h_jacobian) / innovationCovariance;

        // ปรับปรุงค่า SOC และค่าความคลาดเคลื่อนให้มีความแม่นยำสูงขึ้น (Updated State)
        let correctedSoc = predictedSoc + (kalmanGain * innovation);
        correctedSoc = Math.max(0.0, Math.min(1.0, correctedSoc));

        this.errorCovariance = (1 - (kalmanGain * h_jacobian)) * this.errorCovariance;

        return correctedSoc;
    }
}