/**
 * ==============================================================================
 * MODULE: Industrial BMS Matrix Controller, Protection Suite & Telemetry Node
 * Feature: Overcurrent & Short-Circuit Check, CANBus / RS485 Data Bus Formatter
 * Developer: Jakkrit Jathongkham (Control & Automation Systems Engineering)
 * ==============================================================================
 */

import { BatteryCell } from './BatteryModel.js';
import { BmsLogger } from './BmsLogger.js';
import { BalancingOptimizer } from './BalancingOptimizer.js';
import { StateOfChargeEstimator } from './StateOfChargeEstimator.js';

export class BmsController {
    constructor() {
        this.cells = [];
        this.mosfet = { chargeGateClosed: true, dischargeGateClosed: true };
        this.systemMode = 'passive'; 
        this.targetThresholdV = 0.015; 
        this.totalLossJoules = 0.0;
        this.energyTransferred = 0.0;
        
        this.activeChannels = [false, false, false, false];
        this.balanceCurrents = [0, 0, 0, 0];
        this.flowDirections = [1, 1, 1, 1];
        
        this.rBleed = 4.7;
        this.cFly = 220;
        this.lInd = 47;
        this.fSw = 50;
        
        this.isTripped = false;
        this.tripReason = "";
        
        this.communicationProtocol = "canbus"; 
        this.busTxBuffer = ""; 
        this.packCurrent = 0.0;

        // เรียกใช้งานคลาสเสริมประสิทธิภาพการตรวจสอบบันทึกและวิเคราะห์ค่า
        this.logger = new BmsLogger();
        this.optimizer = new BalancingOptimizer();
        
        // ประกาศตัวกรอง EKF แยกอิสระ 4 ชุดประจำตัวเซลล์
        this.socEstimators = [
            new StateOfChargeEstimator(),
            new StateOfChargeEstimator(),
            new StateOfChargeEstimator(),
            new StateOfChargeEstimator()
        ];
    }

    loadPreset(presetCells) {
        this.isTripped = false;
        this.mosfet.chargeGateClosed = true;
        this.mosfet.dischargeGateClosed = true;
        this.totalLossJoules = 0.0;
        this.energyTransferred = 0.0;
        this.activeChannels = [false, false, false, false];
        this.balanceCurrents = [0, 0, 0, 0];
        
        this.cells = presetCells.map((c, i) => {
            const cellSoh = c.ah < 1.5 ? 0.65 : 0.98;
            return new BatteryCell(i + 1, c.v, c.ah, cellSoh);
        });
    }

    processControlLoop(isLoadActive, simSpeed, dtBase, simulateShortCircuit = false, isAutoMode = true) {
        if (this.isTripped) {
            this.packCurrent = 0.0;
            this.generateBusTelemetry();
            return;
        }

        const dt = dtBase * (simSpeed / 20);

        let currentAmps = 0.0;
        if (simulateShortCircuit) {
            currentAmps = -95.0;
        } else if (isLoadActive && this.mosfet.dischargeGateClosed) {
            currentAmps = -12.0;
        }
        this.packCurrent = currentAmps;

        // 1. อัปเดตฟิสิกส์และความร้อนพร้อมประมาณค่าสถานะด้วยโมเดล Dynamic-EKF Engine
        this.cells.forEach((c, idx) => {
            c.updatePhysicsStep(currentAmps, dt);
            c.soc = this.socEstimators[idx].estimateStateOfCharge(c.soc, currentAmps, c.v_terminal, c, dt);
        });

        // 2. การตรวจสอบระบบความปลอดภัยคุ้มครองครอบคลุม 5 มิติ (Protection Matrix)
        this.executeProtectionLogic(currentAmps);
        
        if (this.isTripped) {
            this.logger.logFault(this.tripReason, this.cells, this.packCurrent);
            return;
        }

        const voltages = this.cells.map(c => c.v_terminal);
        const maxV = Math.max(...voltages);
        const minV = Math.min(...voltages);
        const delta = maxV - minV;

        if (isAutoMode) {
            const deltaMV = delta * 1000;
            this.systemMode = this.optimizer.selectOptimalTopology(deltaMV, this.packCurrent, this.totalLossJoules);
        }

        this.activeChannels = [false, false, false, false];
        this.balanceCurrents = [0, 0, 0, 0];

        if (delta > this.targetThresholdV) {
            let currentPowerLoss = 0;

            if (this.systemMode === 'passive') {
                this.cells.forEach((c, idx) => {
                    if (c.v_terminal > minV + this.targetThresholdV) {
                        this.activeChannels[idx] = true;
                        this.flowDirections[idx] = 1; 
                        const iBleed = c.v_terminal / this.rBleed;
                        this.balanceCurrents[idx] = iBleed;
                        currentPowerLoss += iBleed * iBleed * this.rBleed;
                        
                        // [ปรับปรุงจุดวิกฤต]: เพิ่มกำลังการดึงกระแสลบออกเพื่อรีดประจุคายทิ้งให้แรงดันลดลงอย่างเห็นได้ชัด
                        c.updatePhysicsStep(-iBleed * 8.5, dt);
                    }
                });
            }
            else if (this.systemMode === 'capacitor') {
                const scale = (this.cFly * 1e-6) * (this.fSw * 1e3);
                let shunts = [0, 0, 0, 0];
                for (let i = 0; i < 3; i++) {
                    const diff = this.cells[i].v_terminal - this.cells[i+1].v_terminal;
                    const iShuttle = diff * scale;
                    if (Math.abs(diff) > this.targetThresholdV) {
                        // เพิ่มตัวคูณการเคลื่อนย้ายพลังงานในระบบกระสวยประจุจำลอง
                        shunts[i] -= iShuttle * 4.0; shunts[i+1] += iShuttle * 4.0;
                        this.activeChannels[i] = true; this.activeChannels[i+1] = true;
                        this.balanceCurrents[i] = Math.max(this.balanceCurrents[i], Math.abs(iShuttle));
                        this.balanceCurrents[i+1] = Math.max(this.balanceCurrents[i+1], Math.abs(iShuttle));
                        this.flowDirections[i] = iShuttle > 0 ? 1 : -1;
                        this.flowDirections[i+1] = iShuttle > 0 ? -1 : 1;
                        currentPowerLoss += iShuttle * iShuttle * 0.4;
                        this.energyTransferred += Math.abs(iShuttle * diff) * dt;
                    }
                }
                this.cells.forEach((c, i) => c.updatePhysicsStep(shunts[i], dt));
            }
            else if (this.systemMode === 'inductive') {
                let shunts = [0, 0, 0, 0];
                for (let i = 0; i < 3; i++) {
                    const diff = this.cells[i].v_terminal - this.cells[i+1].v_terminal;
                    if (Math.abs(diff) > this.targetThresholdV) {
                        const src = diff > 0 ? i : i+1;
                        const dst = diff > 0 ? i+1 : i;
                        const iPeak = this.cells[src].v_terminal / ((this.lInd * 1e-6) * (this.fSw * 1e3));
                        const iAvg = Math.min(2.8, iPeak * 0.25 * Math.abs(diff));
                        
                        // ขยายขอบเขุกระแสเหนี่ยวนำขดลวด
                        shunts[src] -= iAvg * 3.5; shunts[dst] += iAvg * 3.5 * 0.90;
                        this.activeChannels[src] = true; this.activeChannels[dst] = true;
                        this.balanceCurrents[src] = iAvg; this.balanceCurrents[dst] = iAvg * 0.90;
                        this.flowDirections[src] = 1; this.flowDirections[dst] = -1;
                        currentPowerLoss += iAvg * iAvg * 0.15;
                        this.energyTransferred += Math.abs(iAvg * diff) * dt;
                    }
                }
                this.cells.forEach((c, i) => c.updatePhysicsStep(shunts[i], dt));
            }
            else { 
                let maxIdx = voltages.indexOf(maxV);
                let minIdx = voltages.indexOf(minV);
                this.activeChannels[maxIdx] = true; this.activeChannels[minIdx] = true;
                
                // เพิ่มแอมแปร์สเต็ปในแกนฟลายแบ็ค
                const iTx = 6.5;
                this.cells[maxIdx].updatePhysicsStep(-iTx, dt);
                this.cells[minIdx].updatePhysicsStep(iTx * 0.93, dt);
                this.balanceCurrents[maxIdx] = iTx; this.balanceCurrents[minIdx] = iTx * 0.93;
                this.flowDirections[maxIdx] = 1; this.flowDirections[minIdx] = -1;
                currentPowerLoss = 0.7 + (iTx * iTx * 0.08);
                this.energyTransferred += (iTx * delta) * dt;
            }
            this.totalLossJoules += (currentPowerLoss * dt);
        }

        this.generateBusTelemetry();
    }

    executeProtectionLogic(currentAmps) {
        if (currentAmps <= -80.0) {
            this.isTripped = true;
            this.mosfet.chargeGateClosed = false;
            this.mosfet.dischargeGateClosed = false;
            this.tripReason = "🔥 SHORT-CIRCUIT CRITICAL FAULT ลัดวงจรที่ขั้วภายนอก! กระแสทะลุขีดจำกัดสูงสุด";
            return;
        }

        if (currentAmps <= -15.0) {
            this.isTripped = true;
            this.mosfet.dischargeGateClosed = false;
            this.tripReason = "⚠️ OVERCURRENT FAULT (OCD) ตรวจพบกระแสไฟฟ้าไหลออกเกินขีดจำกัดการใช้งาน!";
            return;
        }

        this.cells.forEach(cell => {
            if (cell.v_terminal >= 4.30) {
                this.isTripped = true;
                this.mosfet.chargeGateClosed = false;
                this.tripReason = "💥 OVERVOLTAGE FAULT (OVP) เซลล์ก้อนที่ 0" + cell.id + " สูงเกินพิกัดเคมีไฟฟ้า!";
            }
            if (cell.v_terminal <= 2.85) {
                this.isTripped = true;
                this.mosfet.dischargeGateClosed = false;
                this.tripReason = "⚡ UNDERVOLTAGE FAULT (UVP) เซลล์ก้อนที่ 0" + cell.id + " แรงดันหมดเกลี้ยงต่ำกว่าจุดวิกฤต!";
            }
            if (cell.tempCore >= 60.0) {
                this.isTripped = true;
                this.mosfet.chargeGateClosed = false;
                this.mosfet.dischargeGateClosed = false;
                this.tripReason = "🌡️ OVER-TEMPERATURE FAULT (OTP) อุณหภูมิภายในเซลล์ทะลุเซฟตี้โซน!";
            }
        });
    }

    generateBusTelemetry() {
        const totalV = this.cells.reduce((sum, c) => sum + c.v_terminal, 0);
        const avgSoc = this.cells.reduce((sum, c) => sum + c.soc, 0) / 4;
        const avgSoh = this.cells.reduce((sum, c) => sum + c.soh, 0) / 4;

        if (this.communicationProtocol === "canbus") {
            const id = "18FF50A4";
            const vHex = Math.round(totalV * 100).toString(16).toUpperCase().padStart(4, '0');
            const cHex = Math.round((this.packCurrent + 320) * 100).toString(16).toUpperCase().padStart(4, '0'); 
            const socHex = Math.round(avgSoc * 255).toString(16).toUpperCase().padStart(2, '0');
            const sohHex = Math.round(avgSoh * 255).toString(16).toUpperCase().padStart(2, '0');
            const statusHex = this.isTripped ? "FF" : "00";
            
            this.busTxBuffer = `ID: 0x${id} | DATA: ${vHex.substring(0,2)} ${vHex.substring(2,4)} ${cHex.substring(0,2)} ${cHex.substring(2,4)} ${socHex} ${sohHex} ${statusHex} 00`;
        } else {
            const slaveAddress = "01";
            const functionCode = "03"; 
            const dataLength = "08";
            const vRegister = Math.round(totalV * 100).toString(16).toUpperCase().padStart(4, '0');
            const socRegister = Math.round(avgSoc * 100).toString(16).toUpperCase().padStart(4, '0');
            const sohRegister = Math.round(avgSoh * 100).toString(16).toUpperCase().padStart(4, '0');
            
            this.busTxBuffer = `:${slaveAddress}${functionCode}${dataLength}${vRegister}${socRegister}${sohRegister}[CRC16]`;
        }
    }
}