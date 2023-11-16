#!/bin/bash

# Print system uptime
echo "System Uptime:"
uptime | awk '{print $3, $4, $5}'

# Check CPU load
echo "CPU Load:"
top -l 1 | grep "Load Avg" | awk '{print $3, $4, $5}'

# Check Disk Usage (total used and available space across all disks)
echo "Total Disk Usage (GB):"
df -h | awk 'NR>1 {used+=$3; avail+=$4} END {print "Used:", used "GB, Available:", avail "GB"}'


# Check Memory Usage (used vs. available)
echo "Memory Usage:"
top -l 1 | awk '/PhysMem/ {print "Used:", $2, "Available:", $6}'