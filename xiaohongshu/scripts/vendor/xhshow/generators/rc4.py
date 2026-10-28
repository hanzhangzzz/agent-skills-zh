"""RC4 primitive used solely for upstream browser fingerprint compatibility.
Not a general-purpose credential encryption mechanism.
"""
class ARC4:
    @staticmethod
    def new(key):
        return ARC4(key)

    def __init__(self, key):
        self.state = list(range(256))
        j = 0
        for i in range(256):
            j = (j + self.state[i] + key[i % len(key)]) % 256
            self.state[i], self.state[j] = self.state[j], self.state[i]
        self.i = self.j = 0

    def encrypt(self, data):
        output = bytearray()
        for value in data:
            self.i = (self.i + 1) % 256
            self.j = (self.j + self.state[self.i]) % 256
            self.state[self.i], self.state[self.j] = self.state[self.j], self.state[self.i]
            output.append(value ^ self.state[(self.state[self.i] + self.state[self.j]) % 256])
        return bytes(output)
