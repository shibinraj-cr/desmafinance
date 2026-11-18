"""Builds the synthetic .xlsx fixtures for tests/xlsx-readers.test.ts.

openpyxl writes cells the way Excel stores them (dates and times as serial
numbers with a number format), so the readers are tested against a file SheetJS
did not write itself. Every name, number and date here is made up: the
repository is public.

    python3 tests/fixtures/spreadsheets/make_fixtures.py
"""
import datetime
import os

from openpyxl import Workbook

HERE = os.path.dirname(os.path.abspath(__file__))


def attendance():
    """The biometric periodic report after Excel re-saves it: dates and punch
    times become real date/time cells."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Report"
    ws.append(["Weekly Periodic Report", "", "", "", "", "", "", "", "01/11/2026 To 07/11/2026"])
    ws.append(["Test Company Pvt Ltd"])
    ws.append(["Dept. Name", "", "Default"])
    header = ["Date", "Shift", "INTime", "Late In", "Erl Out", "OUTTime", "Work+OT", "Over Time", "Status", "Remark"]
    for code, name, days in (
        ("0001", "Test Employee One", [
            (datetime.date(2026, 11, 2), "A", datetime.time(9, 4), datetime.time(17, 35), "P", "--"),
            (datetime.date(2026, 11, 3), "A", datetime.time(9, 0), datetime.time(13, 32), "P", "--"),
            (datetime.date(2026, 11, 7), "A", datetime.time(9, 1), datetime.time(16, 2), "P", "--"),
        ]),
        ("0002", "Test Employee Two", [
            (datetime.date(2026, 11, 2), "B", None, None, "A", "--"),
            (datetime.date(2026, 11, 3), "B", datetime.time(9, 30), None, "P", "--"),
        ]),
    ):
        ws.append(["Empcode", code, "", "Name", name])
        ws.cell(row=ws.max_row, column=2).number_format = "@"
        ws.append(header)
        for d, shift, tin, tout, status, remark in days:
            ws.append([d, shift, tin if tin else "--:--", "00:00", "00:00", tout if tout else "--:--", "08:00", "00:00", status, remark])
            r = ws.max_row
            ws.cell(row=r, column=1).number_format = "dd/mm/yyyy"
            for col in (3, 6):
                if ws.cell(row=r, column=col).is_date:
                    ws.cell(row=r, column=col).number_format = "hh:mm"
    wb.save(os.path.join(HERE, "attendance.xlsx"))


def leads():
    """A lead import sheet with real date-of-birth cells, day-first."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Leads"
    ws.append(["Candidate Name", "Phone", "Email", "DOB"])
    ws.append(["Test Lead One", 919876543210, "one@example.test", datetime.date(1995, 11, 10)])
    ws.append(["Test Lead Two", "9876543211", "two@example.test", datetime.date(1990, 12, 25)])
    for r in (2, 3):
        ws.cell(row=r, column=4).number_format = "dd/mm/yyyy"
    wb.save(os.path.join(HERE, "leads.xlsx"))


def employees():
    """An employee master sheet with long numbers typed as numbers."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Employees"
    ws.append(["Sl No", "Name", "Phone", "Aadhar", "Account Number", "Join Date"])
    ws.append([7, "Test Employee Seven", 9876543210, 123456789012, 912010012345678, datetime.date(2026, 4, 1)])
    ws.cell(row=2, column=6).number_format = "dd-mmm-yyyy"
    wb.save(os.path.join(HERE, "employees.xlsx"))


def meta():
    """A Meta lead export someone opened and saved in Excel: the created time is
    a real date-time cell and the phone a number."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Test Campaign"
    ws.append(["Created Time", "Full Name", "Phone Number", "Email"])
    ws.append([datetime.datetime(2026, 11, 10, 23, 15), "Test Meta One", 919876543210, "m1@example.test"])
    ws.append([datetime.datetime(2026, 11, 1, 0, 5), "Test Meta Two", 919876543211, "m2@example.test"])
    for r in (2, 3):
        ws.cell(row=r, column=1).number_format = "yyyy-mm-dd hh:mm"
    wb.save(os.path.join(HERE, "meta.xlsx"))


def wealth():
    """A holdings sheet with a real valuation-date cell."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Money"
    ws.append(["Name", "Value", "As on"])
    ws.append(["Test Fixed Deposit", 100000, datetime.date(2026, 10, 10)])
    ws.cell(row=2, column=3).number_format = "dd-mmm-yyyy"
    wb.save(os.path.join(HERE, "wealth.xlsx"))


if __name__ == "__main__":
    attendance()
    leads()
    employees()
    meta()
    wealth()
    print("fixtures written")
