"""Author static engineering readouts exclusively for offline cockpit renders."""
import math


class Display:
    def __init__(self, source, title):
        self.source = source
        self.commands = []
        self.height = source['canvasHeight']
        self.rect(0, 0, 1024, self.height, '#091418')
        self.text(title, 38, 49, 25)
        self.line([(38, 67), (986, 67)], '#49616a')
        self.text('FD / ENGINEERING', 38, self.height - 23, 15, '#627d83')
        self.text('NOMINAL', 847, self.height - 23, 17, '#bca66e')

    def text(self, body, horizontal, vertical, size=22, color='#a2b9bc'):
        self.commands.append({'type': 'text', 'text': body, 'horizontal': horizontal,
                              'vertical': vertical, 'font': f'{size}px', 'color': color})

    def line(self, points, color='#638891', width=1.5):
        self.commands.append({'type': 'line', 'points': points, 'color': color, 'width': width})

    def rect(self, horizontal, vertical, width, height, color):
        self.commands.append({'type': 'rect', 'horizontal': horizontal, 'vertical': vertical,
                              'width': width, 'height': height, 'color': color})

    def outline(self, horizontal, vertical, width, height, color='#4a656f'):
        self.line([(horizontal, vertical), (horizontal + width, vertical),
                   (horizontal + width, vertical + height), (horizontal, vertical + height),
                   (horizontal, vertical)], color)

    def graph(self, left, top, width, height, phase, amplitude):
        self.outline(left, top, width, height)
        for fraction in (.25, .5, .75):
            self.line([(left, top + height * fraction),
                       (left + width, top + height * fraction)], '#233b43', 1)
        points = []
        for sample in range(81):
            ratio = sample / 80
            value = .48 + amplitude * (math.sin(ratio * 14 + phase) * .57
                                       + math.sin(ratio * 49 + phase) * .18)
            points.append((left + width * ratio, top + height * value))
        self.line(points, '#8eaeb1', 2)


def electrical(source):
    display = Display(source, 'ELECTRICAL / POWER DISTRIBUTION')
    bottom = display.height - 72
    for index, (name, value, fill) in enumerate((('BUS A', '28.4 V', .79),
                                                ('BUS B', '28.3 V', .77),
                                                ('LOAD', '64.2 A', .53))):
        horizontal = 54 + index * 178
        display.text(name, horizontal, 107, 23)
        display.outline(horizontal, 130, 45, bottom - 162)
        display.rect(horizontal + 4, 134 + (bottom - 170) * (1 - fill),
                     37, (bottom - 170) * fill, '#678b89')
        display.text(value, horizontal, bottom, 23)
    display.line([(592, 92), (592, bottom)], '#3e565e')
    for index, label in enumerate(('MAIN FEED', 'AUXILIARY', 'BATTERY', 'CABIN DC')):
        vertical = 111 + index * (bottom - 144) / 3
        display.outline(647, vertical - 20, 287, 36)
        display.rect(661, vertical - 9, 10, 10, '#9aa47d')
        display.text(label, 693, vertical + 3, 20)
        if index < 3:
            display.line([(793, vertical + 16), (793, vertical + (bottom - 144) / 3 - 20)])
    return display.commands


def navigation(source):
    display = Display(source, 'NAVIGATION / RELATIVE MOTION')
    center = (313, (display.height + 73) / 2)
    radius = min(144, (display.height - 160) / 2)
    for fraction in (.5, 1):
        display.line([(center[0] + radius * fraction * math.sin(step * math.tau / 64),
                       center[1] + radius * fraction * math.cos(step * math.tau / 64))
                      for step in range(65)], '#3d5861')
    display.line([(center[0] - radius, center[1]), (center[0] + radius, center[1])], '#3d5861')
    display.line([(center[0], center[1] - radius), (center[0], center[1] + radius)], '#3d5861')
    display.line([(center[0] - 81, center[1] + 64), (center[0] - 18, center[1] + 21),
                  center, (center[0] + 87, center[1] - 69)], '#bfa974', 2)
    display.line([(center[0] - 11, center[1] + 8), (center[0], center[1] - 15),
                  (center[0] + 11, center[1] + 8), (center[0] - 11, center[1] + 8)], '#b8cbca', 2)
    for index, (label, value) in enumerate((('FRAME', 'LOCAL'), ('RANGE', '12.46 km'),
                                           ('CLOSURE', '0.00 m/s'), ('RCS', 'STANDBY'))):
        vertical = 119 + index * (display.height - 220) / 3
        display.text(label, 601, vertical, 20, '#718d93')
        display.text(value, 763, vertical, 22)
    return display.commands


def life_support(source):
    display = Display(source, 'CABIN / ATMOSPHERE')
    for index, (label, value) in enumerate((('PRESSURE', '101.2 kPa'), ('OXYGEN', '20.9 %'),
                                           ('CO2', '640 ppm'))):
        vertical = 132 + index * 58
        display.text(label, 58, vertical, 27, '#76969d')
        display.text(value, 571, vertical, 31)
    display.text('PRESSURE TREND / 10 MIN', 58, 321, 22)
    display.graph(58, 344, 901, display.height - 419, .42, .10)
    return display.commands


def avionics(source):
    display = Display(source, 'AVIONICS / THERMAL CONTROL')
    for index, (label, temperature) in enumerate((('FCU 1', 34.6), ('FCU 2', 33.8),
                                                  ('RADIO', 39.1), ('NAV', 36.4))):
        vertical = 135 + index * 62
        display.text(label, 57, vertical, 27)
        display.rect(255, vertical - 22, 476, 19, '#223b44')
        display.rect(255, vertical - 22, 476 * temperature / 65, 19, '#719393')
        display.text(f'{temperature:.1f} C', 788, vertical, 27)
    display.text('COOLANT RETURN / 10 MIN', 57, 399, 22)
    display.graph(58, 425, 901, display.height - 500, 1.7, .15)
    return display.commands


def refine(description):
    if description.get('scene') != 'spaceship':
        return description
    screens = []
    replaced = set()
    for original in description.get('screens', []):
        position = original['matrix']
        function = None
        if 11.85 < -position[14] < 12 and .8 < position[13] < 1.2:
            function = electrical if position[12] < -1 else navigation if position[12] > 1 else None
        elif 10 < -position[14] < 11 and 1.5 < position[13] < 2 and 2.3 < abs(position[12]) < 3:
            function = life_support if position[12] < 0 else avionics
        if function:
            replacement = dict(original)
            replacement['commands'] = function(original)
            replacement['offline_readout'] = function.__name__
            screens.append(replacement)
            replaced.add(function.__name__)
        else:
            screens.append(original)
    if replaced != {'electrical', 'navigation', 'life_support', 'avionics'}:
        raise ValueError(f'Expected four distinct cockpit engineering screens, found {sorted(replaced)}')
    return {**description, 'screens': screens}
