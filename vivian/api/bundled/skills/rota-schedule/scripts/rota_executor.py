#!/usr/bin/env python3
"""
子系统 AB 角和发布窗口管理工具

支持：
1. 按子系统查询 AB 角和发布窗口
2. 按人员查询负责的子系统
3. 按系统修改发布窗口时间
"""

import subprocess
import sys
import json
import argparse

SCRIPT_DIR = "/home/app/vivian_workspace/jorgenchen"
DB_EXECUTOR = f"{SCRIPT_DIR}/db_executor.py"
DATABASE = "pros_monitor"


def format_output(output: str) -> str:
    """格式化输出结果"""
    lines = output.strip().split('\n')
    result = []
    for line in lines:
        # 处理转义字符
        line = line.replace('\\t', '\t')
        line = line.replace('\\n', '\n')
        if line.strip():
            result.append(line)
    return '\n'.join(result)


def query_by_system(system_name: str) -> str:
    """按子系统名称查询 AB 角和发布窗口"""
    sql = f"""SELECT system_name, first_principal, second_principal, schedule_start, schedule_end, ops_group, domain
              FROM auto_rota_operation_scheduling
              WHERE system_name LIKE '%{system_name}%';"""

    cmd = ["python", DB_EXECUTOR, "--db", DATABASE, "--sql", sql]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return format_output(result.stdout) if result.returncode == 0 else format_output(result.stderr)


def query_by_person(person_name: str) -> str:
    """按人员名称查询负责的子系统（A 角或 B 角）"""
    sql = f"""SELECT system_name, first_principal, second_principal, schedule_start, schedule_end, ops_group, domain
              FROM auto_rota_operation_scheduling
              WHERE first_principal LIKE '%{person_name}%' OR second_principal LIKE '%{person_name}%';"""

    cmd = ["python", DB_EXECUTOR, "--db", DATABASE, "--sql", sql]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return format_output(result.stdout) if result.returncode == 0 else format_output(result.stderr)


def update_schedule(system_name: str, start_time: str, end_time: str) -> str:
    """修改指定子系统的发布窗口时间"""
    sql = f"""UPDATE auto_rota_operation_scheduling
              SET schedule_start='{start_time}', schedule_end='{end_time}'
              WHERE system_name LIKE '%{system_name}%';"""

    cmd = ["python", DB_EXECUTOR, "--db", DATABASE, "--sql", sql]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return format_output(result.stdout) if result.returncode == 0 else format_output(result.stderr)


def list_all_systems() -> str:
    """列出所有子系统的 AB 角和发布窗口"""
    sql = """SELECT system_name, first_principal, second_principal, schedule_start, schedule_end, ops_group, domain
             FROM auto_rota_operation_scheduling
             ORDER BY domain, system_name;"""

    cmd = ["python", DB_EXECUTOR, "--db", DATABASE, "--sql", sql]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return format_output(result.stdout) if result.returncode == 0 else format_output(result.stderr)


def main():
    parser = argparse.ArgumentParser(description='子系统 AB 角和发布窗口管理工具')
    parser.add_argument('--query-system', '-qs', help='按子系统名称查询')
    parser.add_argument('--query-person', '-qp', help='按人员名称查询')
    parser.add_argument('--update', '-u', nargs=3, metavar=('SYSTEM', 'START', 'END'),
                        help='修改发布窗口时间 (系统名 开始时间 结束时间)')
    parser.add_argument('--list-all', '-l', action='store_true', help='列出所有子系统')

    args = parser.parse_args()

    if args.query_system:
        print(query_by_system(args.query_system))
    elif args.query_person:
        print(query_by_person(args.query_person))
    elif args.update:
        system, start, end = args.update
        print(update_schedule(system, start, end))
    elif args.list_all:
        print(list_all_systems())
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
