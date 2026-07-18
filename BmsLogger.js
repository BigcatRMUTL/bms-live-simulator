/**
 * ==============================================================================
 * MODULE: Advanced BMS Fault Logger & Health Analytics Node
 * Feature: Real-time Fault Capture, Chronological History, CSV Export Simulation
 * Developer: Jakkrit Jathongkham (Control & Automation Systems Engineering)
 * ==============================================================================
 */

export class BmsLogger {
    constructor() {
        this.faultHistory = [];
    }

    /**
     * บันทึกประวัติเมื่อระบบเกิด Critical Fault
     */
    logFault(reason, cells, packCurrent) {
        const timestamp = new Date().toISOString();
        const snapshot = {
            timestamp: timestamp,
            reason: reason,
            packCurrent: packCurrent,
            cellVoltages: cells.map(c => c.v_terminal),
            cellTemperatures: cells.map(c => c.tempCore),
            cellSoh: cells.map(c => c.soh)
        };
        
        this.faultHistory.push(snapshot);
        console.warn(`[BMS LOGGER] Fault Recorded at ${timestamp}: ${reason}`);
    }

    /**
     * คำนวณและประเมินสุขภาพโดยรวมของ Battery Pack
     */
    analyzePackHealth(cells) {
        const sohValues = cells.map(c => c.soh);
        const minSoh = Math.min(...sohValues);
        const worstCellIdx = sohValues.indexOf(minSoh) + 1;
        
        let recommendation = "🔋 สภาพแบตเตอรี่โดยรวมสมบูรณ์ดีเยี่ยม";
        if (minSoh < 0.75) {
            recommendation = `🚨 วิกฤต: Cell 0${worstCellIdx} เสื่อมสภาพรุนแรง (SOH: ${(minSoh * 100).toFixed(1)}%) ควรเปลี่ยนเซลล์ใหม่`;
        } else if (minSoh < 0.85) {
            recommendation = `⚠️ แจ้งเตือน: Cell 0${worstCellIdx} เริ่มเสื่อมสภาพ (SOH: ${(minSoh * 100).toFixed(1)}%) ให้เฝ้าระวังอุณหภูมิ`;
        }

        return {
            minimumSoh: minSoh,
            worstCell: worstCellIdx,
            recommendation: recommendation
        };
    }

    /**
     * จำลองการดึงข้อมูลประวัติความผิดพลาดออกมาเป็น CSV
     */
    exportHistoryToCSV() {
        if (this.faultHistory.length === 0) return "No fault logs recorded.";
        
        let csvContent = "Timestamp,Reason,PackCurrent,Cell1_V,Cell2_V,Cell3_V,Cell4_V\n";
        this.faultHistory.forEach(log => {
            csvContent += `${log.timestamp},"${log.reason}",${log.packCurrent},${log.cellVoltages.join(',')}\n`;
        });
        return csvContent;
    }
}